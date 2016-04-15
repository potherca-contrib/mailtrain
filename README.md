# Mailtrain

[Mailtrain](http://mailtrain.org) is a self hosted newsletter application built on Node.js (v5+) and MySQL (v5.5+ or MariaDB).

![](http://mailtrain.org/mailtrain.png)

## Features

Mailtrain supports subscriber list management, list segmentation, custom fields, email templates, large CSV list import files, etc.

Subscribe to Mailtrain Newsletter [here](http://mailtrain.org/subscription/EysIv8sAx) (uses Mailtrain obviously)

## Cons

  * Alpha-grade software. Might or might not work as expected
  * Awful code base, needs refactoring
  * No tests
  * No documentation

## Requirements

  * Nodejs v5+
  * MySQL v5.5 or MariaDB
  * Redis (optional, used for session storage only)

## Installation

  1. Download and unpack Mailtrain [sources](https://github.com/andris9/mailtrain/archive/master.zip)
  2. Run `npm install` in the Mailtrain folder to install required dependencies
  3. Copy [config/default.toml](config/default.toml) as `config/production.toml` and update MySQL settings in it
  4. Import SQL tables by running `mysql -u MYSQL_USER -p MYSQL_DB < setup/mailtrain.sql`
  5. Run the server `NODE_ENV=production npm start`
  6. Open [http://localhost:3000/](http://localhost:3000/)
  7. Authenticate as `admin`:`test`
  8. Navigate to [http://localhost:3000/settings](http://localhost:3000/settings) and update service configuration
  9. Navigate to [http://localhost:3000/users/account](http://localhost:3000/users/account) and update user information and password

## Using environment variables

Some servers expose custom port and hostname options through environment variables. To support these, create a new configuration file `config/local.js`:

```
module.exports = {
    www: {
        port: process.env.OPENSHIFT_NODEJS_PORT,
        host: process.env.OPENSHIFT_NODEJS_IP
    }
};
```

Mailtrain uses [node-config](https://github.com/lorenwest/node-config) for configuration management and thus the config files are loaded in the following order:

  1. default.toml
  2. {NODE_ENV}.toml (eg. development.toml or production.toml)
  3. local.js

## Running behind Nginx proxy

Edit [mailtrain.nginx](setup/mailtrain.nginx) (update `server_name` directive) and copy it to `/etc/nginx/sites-enabled`

## Running as an Upstart service in Ubuntu 14.04

Edit [mailtrain.conf](setup/mailtrain.conf) (update application folder) and copy it to `/etc/init`

## Deploy to Heroku

You can quickly deploy MailTrain to [Heroku](https://heroku.com/) using the provided "Deploy to Heroku" button:

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

This will deploy your very own instance of MailTrain on Heroku, including the needed Add-ons and Config Variables.

### Add-ons

MailTrain requires a Mysql and Redis database to function, these are automatically added.
As Heroku does not preserve logs, an add-on to persist logs is also added.

The free tier of the following add-ons will be used:

 - [Heroku Redis](https://elements.heroku.com/addons/heroku-redis) (Hobby Dev)
 - [JawsDB Maria](https://elements.heroku.com/addons/jawsdb-maria) (Kitefin)
 - [PaperTrail](https://elements.heroku.com/addons/papertrail) (Choklad)

If another add-on is preferred to provide a database, this can be changed at a later time.
In such a case the corresponding variables will need to be changed in the `custom-environment-variables.json` file or overwritten from the `NODE_CONFIG` environment variable.

### Config Variables

The following environmental variables are used for/by a Heroku deploy:

- `JAWSDB_MARIA_URL` - URL where the MariaDB database resides.
- `NODE_CONFIG` - Used to overwrite settings defined in the `default.toml`.
- `REDIS_URL` - URL where the Redis database resides.
- `WWW_SECRET` - Secret for signing the session ID cookie.

## Nitrous Quickstart

You can quickly create a free development environment for this Mailtrain project in the cloud on www.nitrous.io:

<a href="https://www.nitrous.io/quickstart">
  <img src="https://nitrous-image-icons.s3.amazonaws.com/quickstart.png" alt="Nitrous Quickstart" width=142 height=34>
</a>

In the IDE, start Mailtrain via `Run > Start Mailtrain` and access your site via `Preview > 3000`.

## Bounce handling

Mailtrain uses webhooks integration to detect bounces and spam complaints. Currently supported webhooks are:

  * **AWS SES** – create a SNS topic for complaints and bounces and use `http://domain/webhooks/aws` as the subscriber URL for these topics
  * **SparkPost** – use `http://domain/webhooks/sparkpost` as the webhook URL for bounces and complaints
  * **SendGrid** – use `http://domain/webhooks/sendgrid` as the webhook URL for bounces and complaints
  * **Mailgun** – use `http://domain/webhooks/mailgun` as the webhook URL for bounces and complaints

Additionally Mailtrain (v1.1+) is able to use VERP-based bounce handling. This would require to have a compatible SMTP relay (the services mentioned above strip out or block VERP addresses in the SMTP envelope) and you also need to set up special MX DNS name that points to your Mailtrain installation server.

## License

**GPL-V3.0**
