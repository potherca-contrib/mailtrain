'use strict';

let log = require('npmlog');
let config = require('config');
let db = require('../lib/db');
let tools = require('../lib/tools');
let mailer = require('../lib/mailer');
let campaigns = require('../lib/models/campaigns');
let segments = require('../lib/models/segments');
let lists = require('../lib/models/lists');
let fields = require('../lib/models/fields');
let settings = require('../lib/models/settings');
let links = require('../lib/models/links');
let shortid = require('shortid');
let url = require('url');

function findUnsent(callback) {
    db.getConnection((err, connection) => {
        if (err) {
            return callback(err);
        }

        let query = 'SELECT id, list, segment FROM campaigns WHERE status=? LIMIT 1';
        connection.query(query, [2], (err, rows) => {
            if (err) {
                connection.release();
                return callback(err);
            }
            if (!rows || !rows.length) {
                connection.release();
                return callback(null, false);
            }

            let campaign = tools.convertKeys(rows[0]);

            let getSegmentQuery = (segmentId, next) => {
                segmentId = Number(segmentId);
                if (!segmentId) {
                    return next(null, {
                        where: '',
                        values: []
                    });
                }
                segments.getQuery(segmentId, next);
            };

            getSegmentQuery(campaign.segment, (err, queryData) => {
                if (err) {
                    return callback(err);
                }

                let tryNext = () => {
                    let query = 'SELECT * FROM `subscription__' + campaign.list + '` subscription WHERE status=1 ' + (queryData.where ? ' AND (' + queryData.where + ')' : '') + ' AND NOT EXISTS (SELECT 1 FROM `campaign__' + campaign.id + '` campaign WHERE campaign.list = ? AND campaign.segment = ? AND campaign.subscription = subscription.id) LIMIT 1';

                    connection.query(query, queryData.values.concat([campaign.list, campaign.segment]), (err, rows) => {
                        if (err) {
                            connection.release();
                            return callback(err);
                        }

                        if (!rows || !rows.length) {
                            // everything already processed for this campaign
                            return connection.query('UPDATE campaigns SET `status`=3, `status_change`=NOW() WHERE id=? LIMIT 1', [campaign.id], () => {
                                connection.release();
                                return callback(null, false);
                            });
                        }

                        let subscription = tools.convertKeys(rows[0]);
                        let query = 'INSERT INTO `campaign__' + campaign.id + '` (list, segment, subscription) VALUES(?, ?,?)';
                        connection.query(query, [campaign.list, campaign.segment, subscription.id], (err, result) => {
                            if (err) {
                                if (err.code === 'ER_DUP_ENTRY') {
                                    // race condition, try next one
                                    return tryNext();
                                }
                                connection.release();
                                return callback(err);
                            }
                            connection.release();
                            subscription.campaign = campaign.id;
                            callback(null, {
                                id: result.insertId,
                                listId: campaign.list,
                                campaignId: campaign.id,
                                subscription
                            });
                        });
                    });
                };
                tryNext();
            });
        });
    });
}

function formatMessage(message, callback) {
    campaigns.get(message.campaignId, false, (err, campaign) => {
        if (err) {
            return callback(err);
        }
        if (!campaign) {
            return callback(new Error('Campaign not found'));
        }

        lists.get(message.listId, (err, list) => {
            if (err) {
                return callback(err);
            }
            if (!list) {
                return callback(new Error('List not found'));
            }

            settings.list(['serviceUrl', 'verpUse', 'verpHostname'], (err, configItems) => {
                if (err) {
                    return callback(err);
                }

                let useVerp = config.verp.enabled && configItems.verpUse && configItems.verpHostname;

                fields.list(list.id, (err, fieldList) => {
                    if (err) {
                        return callback(err);
                    }

                    message.subscription.mergeTags = {
                        EMAIL: message.subscription.email,
                        FIRST_NAME: message.subscription.firstName,
                        LAST_NAME: message.subscription.lastName,
                        FULL_NAME: [].concat(message.subscription.firstName || []).concat(message.subscription.lastName || []).join(' ')
                    };

                    fields.getRow(fieldList, message.subscription, true, true).forEach(field => {
                        if (field.mergeTag) {
                            message.subscription.mergeTags[field.mergeTag] = field.mergeValue || '';
                        }
                        if (field.options) {
                            field.options.forEach(subField => {
                                if (subField.mergeTag) {
                                    message.subscription.mergeTags[subField.mergeTag] = subField.mergeValue || '';
                                }
                            });
                        }
                    });

                    links.updateLinks(campaign, list, message.subscription, configItems.serviceUrl, campaign.html, (err, html) => {
                        if (err) {
                            return callback(err);
                        }

                        // replace data: images with embedded attachments
                        let attachments = [];
                        html = html.replace(/(<img\b[^>]* src\s*=[\s"']*)(data:[^"'>\s]+)/gi, (match, prefix, dataUri) => {
                            let cid = shortid.generate() + '-attachments@' + campaign.address.split('@').pop();
                            attachments.push({
                                path: dataUri,
                                cid
                            });
                            return prefix + 'cid:' + cid;
                        });

                        let campaignAddress = [campaign.cid, list.cid, message.subscription.cid].join('.');

                        return callback(null, {
                            from: {
                                name: campaign.from,
                                address: campaign.address
                            },
                            xMailer: 'Mailtrain Mailer (+https://mailtrain.org)',
                            to: {
                                name: [].concat(message.subscription.firstName || []).concat(message.subscription.lastName || []).join(' '),
                                address: message.subscription.email
                            },
                            sender: useVerp ? campaignAddress + '@' + configItems.verpHostname : false,

                            envelope: useVerp ? {
                                from: campaignAddress + '@' + configItems.verpHostname,
                                to: message.subscription.email
                            } : false,

                            headers: {
                                'x-fbl': campaignAddress,
                                // custom header for SparkPost
                                'x-msys-api': JSON.stringify({
                                    campaign_id: campaignAddress
                                }),
                                // custom header for SendGrid
                                'x-smtpapi': JSON.stringify({
                                    unique_args: {
                                        campaign_id: campaignAddress
                                    }
                                }),
                                // custom header for Mailgun
                                'x-mailgun-variables': JSON.stringify({
                                    campaign_id: campaignAddress
                                }),
                                'List-ID': {
                                    prepared: true,
                                    value: '"' + list.name.replace(/[^a-z0-9\s'.,\-]/g, '').trim() + '" <' + list.cid + '.' + (url.parse(configItems.serviceUrl).hostname || 'localhost') + '>'
                                }
                            },
                            list: {
                                unsubscribe: url.resolve(configItems.serviceUrl, '/subscription/' + list.cid + '/unsubscribe/' + message.subscription.cid + '?auto=yes')
                            },
                            subject: tools.formatMessage(configItems.serviceUrl, campaign, list, message.subscription, campaign.subject),
                            html: tools.formatMessage(configItems.serviceUrl, campaign, list, message.subscription, html),
                            text: tools.formatMessage(configItems.serviceUrl, campaign, list, message.subscription, campaign.text),

                            attachments
                        });
                    });
                });
            });
        });
    });
}

let sendLoop = () => {
    mailer.getMailer(err => {
        if (err) {
            log.error('Mail', err.stack);
            return setTimeout(sendLoop, 10 * 1000);
        }

        let getNext = () => {
            if (!mailer.transport.isIdle()) {
                // only retrieve new messages if there are free slots in the mailer queue
                return;
            }

            // find an unsent message
            findUnsent((err, message) => {
                if (err) {
                    log.error('Mail', err.stack);
                    setTimeout(getNext, 5 * 1000);
                    return;
                }
                if (!message) {
                    setTimeout(getNext, 5 * 1000);
                    return;
                }

                //log.verbose('Mail', 'Found new message to be delivered: %s', message.subscription.cid);

                // format message to nodemailer message format
                formatMessage(message, (err, mail) => {
                    if (err) {
                        log.error('Mail', err.stack);
                        setTimeout(getNext, 5 * 1000);
                        return;
                    }

                    // send the message
                    mailer.transport.sendMail(mail, (err, info) => {
                        if (err) {
                            log.error('Mail', err.stack);
                        }

                        let status = err ? 2 : 1;
                        let response = err && (err.response || err.message) || info.response;

                        let responseId = response.split(/\s+/).pop();

                        db.getConnection((err, connection) => {
                            if (err) {
                                log.error('Mail', err.stack);
                                return;
                            }

                            let query = 'UPDATE `campaigns` SET `delivered`=`delivered`+1 ' + (status === 2 ? ', `bounced`=`bounced`+1 ' : '') + ' WHERE id=? LIMIT 1';
                            connection.query(query, [message.campaignId], err => {
                                if (err) {
                                    log.error('Mail', err.stack);
                                }

                                let query = 'UPDATE `campaign__' + message.campaignId + '` SET status=?, response=?, response_id=?, updated=NOW() WHERE id=? LIMIT 1';
                                connection.query(query, [status, response, responseId, message.id], err => {
                                    connection.release();
                                    if (err) {
                                        log.error('Mail', err.stack);
                                    } else {
                                        // log.verbose('Mail', 'Message sent and status updated for %s', message.subscription.cid);
                                    }
                                });
                            });
                        });
                    });
                    setImmediate(getNext);
                });
            });
        };

        mailer.transport.on('idle', getNext);
    });
};

sendLoop();
