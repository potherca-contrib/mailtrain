'use strict';

let passport = require('../lib/passport');
let express = require('express');
let router = new express.Router();
let lists = require('../lib/models/lists');
let subscriptions = require('../lib/models/subscriptions');
let fields = require('../lib/models/fields');
let tools = require('../lib/tools');
let striptags = require('striptags');
let htmlescape = require('escape-html');
let multer = require('multer');
let os = require('os');
let humanize = require('humanize');
let uploads = multer({
    dest: os.tmpdir()
});
let csvparse = require('csv-parse');
let fs = require('fs');

router.all('/*', (req, res, next) => {
    if (!req.user) {
        req.flash('danger', 'Need to be logged in to access restricted content');
        return res.redirect('/users/login?next=' + encodeURIComponent(req.originalUrl));
    }
    res.setSelectedMenu('lists');
    next();
});

router.get('/', (req, res) => {
    let limit = 999999999;
    let start = 0;

    lists.list(start, limit, (err, rows, total) => {
        if (err) {
            req.flash('danger', err.message || err);
            return res.redirect('/');
        }

        res.render('lists/lists', {
            rows: rows.map((row, i) => {
                row.index = start + i + 1;
                row.description = striptags(row.description);
                return row;
            }),
            total
        });
    });
});

router.get('/create', passport.csrfProtection, (req, res) => {
    let data = tools.convertKeys(req.query, {
        skip: ['layout']
    });

    data.csrfToken = req.csrfToken();

    res.render('lists/create', data);
});

router.post('/create', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.create(req.body, (err, id) => {
        if (err || !id) {
            req.flash('danger', err && err.message || err || 'Could not create list');
            return res.redirect('/lists/create?' + tools.queryParams(req.body));
        }
        req.flash('success', 'List created');
        res.redirect('/lists/view/' + id);
    });
});

router.get('/edit/:id', passport.csrfProtection, (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }
        list.csrfToken = req.csrfToken();
        res.render('lists/edit', list);
    });
});

router.post('/edit', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.update(req.body.id, req.body, (err, updated) => {

        if (err) {
            req.flash('danger', err.message || err);
        } else if (updated) {
            req.flash('success', 'List settings updated');
        } else {
            req.flash('info', 'List settings not updated');
        }

        if (req.body.id) {
            return res.redirect('/lists/edit/' + encodeURIComponent(req.body.id));
        } else {
            return res.redirect('/lists');
        }
    });
});

router.post('/delete', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.delete(req.body.id, (err, deleted) => {
        if (err) {
            req.flash('danger', err && err.message || err);
        } else if (deleted) {
            req.flash('success', 'List deleted');
        } else {
            req.flash('info', 'Could not delete specified list');
        }

        return res.redirect('/lists');
    });
});

router.post('/ajax/:id', (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            return res.json({
                error: err && err.message || err || 'List not found',
                data: []
            });
        }

        fields.list(list.id, (err, fieldList) => {
            if (err && !fieldList) {
                fieldList = [];
            }

            let columns = ['#', 'email', 'first_name', 'last_name'].concat(fieldList.filter(field => field.visible).map(field => field.column)).concat('status');

            subscriptions.filter(list.id, req.body, columns, req.query.segment, (err, data, total, filteredTotal) => {
                if (err) {
                    return res.json({
                        error: err.message || err,
                        data: []
                    });
                }

                data.forEach(row => {
                    row.subscriptionStatus = row.status === 1 ? true : false;
                    row.customFields = fields.getRow(fieldList, row);
                });

                let statuses = ['Unknown', 'Subscribed', 'Unsubscribed', 'Bounced', 'Complained'];

                res.json({
                    draw: req.body.draw,
                    recordsTotal: total,
                    recordsFiltered: filteredTotal,
                    data: data.map((row, i) => [
                        (Number(req.body.start) || 0) + 1 + i,
                        htmlescape(row.email || ''),
                        htmlescape(row.firstName || ''),
                        htmlescape(row.lastName || '')
                    ].concat(fields.getRow(fieldList, row).map(cRow => {
                        if (cRow.type === 'number') {
                            return htmlescape(cRow.value && humanize.numberFormat(cRow.value, 0) || '');
                        } else {
                            return htmlescape(cRow.value || '');
                        }
                    })).concat(statuses[row.status]).concat('<span class="glyphicon glyphicon-wrench" aria-hidden="true"></span><a href="/lists/subscription/' + list.id + '/edit/' + row.cid + '">Edit</a>'))
                });
            });
        });
    });
});

router.get('/view/:id', passport.csrfProtection, (req, res) => {
    if (Number(req.query.segment) === -1) {
        return res.redirect('/segments/' + encodeURIComponent(req.params.id) + '/create');
    }

    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.listImports(list.id, (err, imports) => {
            if (err) {
                // not important, ignore
                imports = [];
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                list.imports = imports.map((entry, i) => {
                    entry.index = i + 1;
                    entry.processed = humanize.numberFormat(entry.processed, 0);
                    entry.importType = entry.type === 1 ? 'Subscribe' : 'Unsubscribe';
                    switch (entry.status) {
                        case 0:
                            entry.importStatus = 'Initializing';
                            break;
                        case 1:
                            entry.importStatus = 'Initialized';
                            break;
                        case 2:
                            entry.importStatus = 'Importing...';
                            break;
                        case 3:
                            entry.importStatus = 'Finished';
                            break;
                        default:
                            entry.importStatus = 'Errored' + (entry.error ? ' (' + entry.error + ')' : '');
                            entry.error = true;
                    }
                    entry.created = entry.created && entry.created.toISOString();
                    entry.finished = entry.finished && entry.finished.toISOString();
                    return entry;
                });
                list.csrfToken = req.csrfToken();
                list.customFields = fieldList.filter(field => field.visible);
                list.customSort = list.customFields.length ? ',' + list.customFields.map(() => '0').join(',') : '';

                list.showSubscriptions = req.query.tab === 'subscriptions' || !req.query.tab;
                list.showImports = req.query.tab === 'imports';

                list.segments.forEach(segment => {
                    if (segment.id === (Number(req.query.segment) || 0)) {
                        segment.selected = true;
                        list.useSegment = req.query.segment;
                        list.segment = segment.id;
                    }
                });

                res.render('lists/view', list);
            });
        });
    });
});

router.get('/subscription/:id/add', passport.csrfProtection, (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        fields.list(list.id, (err, fieldList) => {
            if (err && !fieldList) {
                fieldList = [];
            }

            let data = tools.convertKeys(req.query, {
                skip: ['layout']
            });

            data.list = list;
            data.csrfToken = req.csrfToken();

            data.customFields = fields.getRow(fieldList, data, false, true);
            data.useEditor = true;

            res.render('lists/subscription/add', data);
        });
    });
});

router.get('/subscription/:id/edit/:cid', passport.csrfProtection, (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.get(list.id, req.params.cid, (err, subscription) => {
            if (err || !subscription) {
                req.flash('danger', err && err.message || err || 'Could not find subscriber with specified ID');
                return res.redirect('/lists/view/' + req.params.id);
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                subscription.list = list;
                subscription.csrfToken = req.csrfToken();

                subscription.customFields = fields.getRow(fieldList, subscription, false, true);
                subscription.useEditor = true;
                subscription.isSubscribed = subscription.status === 1;

                res.render('lists/subscription/edit', subscription);
            });
        });
    });
});

router.post('/subscription/add', passport.parseForm, passport.csrfProtection, (req, res) => {
    subscriptions.insert(req.body.list, false, req.body, (err, entryId) => {
        if (err) {
            req.flash('danger', err && err.message || err || 'Could not add subscription');
            return res.redirect('/lists/subscription/' + encodeURIComponent(req.body.list) + '/add?' + tools.queryParams(req.body));
        }

        if (entryId) {
            req.flash('success', req.body.email + ' was successfully added to your list');
        } else {
            req.flash('warning', req.body.email + ' was not added to your list');
        }

        res.redirect('/lists/subscription/' + encodeURIComponent(req.body.list) + '/add');
    });
});

router.post('/subscription/unsubscribe', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.get(req.body.list, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.get(list.id, req.body.cid, (err, subscription) => {
            if (err || !subscription) {
                req.flash('danger', err && err.message || err || 'Could not find subscriber with specified ID');
                return res.redirect('/lists/view/' + list.id);
            }

            subscriptions.unsubscribe(list.id, subscription.email, err => {
                if (err) {
                    req.flash('danger', err && err.message || err || 'Could not unsubscribe user');
                    return res.redirect('/lists/subscription/' + list.id + '/edit/' + subscription.cid);
                }
                req.flash('success', subscription.email + ' was successfully subscribed from your list');
                res.redirect('/lists/view/' + list.id);
            });
        });
    });
});

router.post('/subscription/delete', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.get(req.body.list, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.delete(list.id, req.body.cid, (err, email) => {
            if (err || !email) {
                req.flash('danger', err && err.message || err || 'Could not find subscriber with specified ID');
                return res.redirect('/lists/view/' + list.id);
            }

            req.flash('success', email + ' was successfully removed from your list');
            res.redirect('/lists/view/' + list.id);
        });
    });
});

router.post('/subscription/edit', passport.parseForm, passport.csrfProtection, (req, res) => {
    subscriptions.update(req.body.list, req.body.cid, req.body, true, (err, updated) => {

        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                req.flash('danger', 'Another subscriber with email address ' + req.body.email + ' already exists');
                return res.redirect('/lists/subscription/' + encodeURIComponent(req.body.list) + '/edit/' + req.body.cid);
            } else {
                req.flash('danger', err.message || err);
            }

        } else if (updated) {
            req.flash('success', 'Subscription settings updated');
        } else {
            req.flash('info', 'Subscription settings not updated');
        }

        if (req.body.list) {
            return res.redirect('/lists/view/' + encodeURIComponent(req.body.list));
        } else {
            return res.redirect('/lists');
        }
    });
});

router.get('/subscription/:id/import', passport.csrfProtection, (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        let data = tools.convertKeys(req.query, {
            skip: ['layout']
        });

        if (!('delimiter' in data)) {
            data.delimiter = ',';
        }

        data.list = list;
        data.csrfToken = req.csrfToken();

        res.render('lists/subscription/import', data);
    });
});

router.get('/subscription/:id/import/:importId', passport.csrfProtection, (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.getImport(req.params.id, req.params.importId, (err, data) => {
            if (err || !list) {
                req.flash('danger', err && err.message || err || 'Could not find import data with specified ID');
                return res.redirect('/lists');
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                data.list = list;
                data.csrfToken = req.csrfToken();

                data.customFields = fields.getRow(fieldList, data);

                res.render('lists/subscription/import-preview', data);
            });
        });
    });
});

router.post('/subscription/import', uploads.single('listimport'), passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.get(req.body.list, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        let delimiter = (req.body.delimiter || '').trim().charAt(0) || ',';

        getPreview(req.file.path, req.file.size, delimiter, (err, rows) => {
            if (err) {
                req.flash('danger', err && err.message || err || 'Could not process CSV');
                return res.redirect('/lists');
            } else {

                subscriptions.createImport(list.id, req.body.type === 'subscribed' ? 1 : 2, req.file.path, req.file.size, delimiter, {
                    columns: rows[0],
                    example: rows[1] || []
                }, (err, importId) => {
                    if (err) {
                        req.flash('danger', err && err.message || err || 'Could not create importer');
                        return res.redirect('/lists');
                    }

                    return res.redirect('/lists/subscription/' + list.id + '/import/' + importId);
                });
            }
        });
    });
});

function getPreview(path, size, delimiter, callback) {
    delimiter = (delimiter || '').trim().charAt(0) || ',';
    size = Number(size);

    fs.open(path, 'r', (err, fd) => {
        if (err) {
            return callback(err);
        }

        let bufLen = size;
        let maxReadSize = 10 * 1024;

        if (size > maxReadSize) {
            bufLen = maxReadSize;
        }

        let buffer = new Buffer(bufLen);
        fs.read(fd, buffer, 0, buffer.length, 0, (err, bytesRead, buffer) => {
            if (err) {
                return callback(err);
            }

            let input = buffer.toString().trim();


            if (size !== bufLen) {
                // remove last incomplete line
                input = input.split(/\r?\n/);
                input.pop();
                input = input.join('\n');
            }

            csvparse(input, {
                comment: '#',
                delimiter
            }, (err, data) => {
                fs.close(fd, () => {
                    // just ignore
                });
                if (!data || !data.length) {
                    return callback(null, new Error('Empty file'));
                }
                callback(err, data);
            });
        });
    });
}

router.post('/subscription/import-confirm', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.get(req.body.list, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.getImport(list.id, req.body.import, (err, data) => {
            if (err || !list) {
                req.flash('danger', err && err.message || err || 'Could not find import data with specified ID');
                return res.redirect('/lists');
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                let allowedColumns = ['email', 'first_name', 'last_name'];
                fieldList.forEach(field => {
                    if (field.column) {
                        allowedColumns.push(field.column);
                    }
                    if (field.options) {
                        field.options.forEach(subField => {
                            if (subField.column) {
                                allowedColumns.push(subField.column);
                            }
                        });
                    }
                });

                data.mapping.mapping = {};
                data.mapping.columns.forEach((column, i) => {
                    let colIndex = allowedColumns.indexOf(req.body['column-' + i]);
                    if (colIndex >= 0) {
                        data.mapping.mapping[allowedColumns[colIndex]] = i;
                    }
                });

                subscriptions.updateImport(list.id, req.body.import, {
                    status: 1,
                    mapping: JSON.stringify(data.mapping)
                }, (err, importer) => {
                    if (err || !importer) {
                        req.flash('danger', err && err.message || err || 'Could not find import data with specified ID');
                        return res.redirect('/lists');
                    }

                    req.flash('success', 'Import started');
                    res.redirect('/lists/view/' + list.id + '?tab=imports');
                });
            });
        });
    });
});

router.post('/subscription/import-restart', passport.parseForm, passport.csrfProtection, (req, res) => {
    lists.get(req.body.list, (err, list) => {
        if (err || !list) {
            req.flash('danger', err && err.message || err || 'Could not find list with specified ID');
            return res.redirect('/lists');
        }

        subscriptions.updateImport(list.id, req.body.import, {
            status: 1,
            error: null,
            finished: null,
            processed: 0
        }, (err, importer) => {
            if (err || !importer) {
                req.flash('danger', err && err.message || err || 'Could not find import data with specified ID');
                return res.redirect('/lists');
            }

            req.flash('success', 'Import restarted');
            res.redirect('/lists/view/' + list.id + '?tab=imports');
        });
    });
});

module.exports = router;
