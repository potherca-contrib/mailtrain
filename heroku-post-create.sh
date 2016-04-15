#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

function arrayFromUrl() {
    echo "$1" | grep -o '[a-z0-9._-][a-z0-9._-]*' | tr '\n' ' '
}

function setMysqlVariables() {

    local FIELDS=($(arrayFromUrl "${JAWSDB_MARIA_URL}"))

    readonly MYSQL_USER="${FIELDS[1]}"
    readonly MYSQL_PASSWORD="${FIELDS[2]}"
    readonly MYSQL_HOST="${FIELDS[3]}"
    readonly MYSQL_PORT="${FIELDS[4]}"
    readonly MYSQL_NAME="${FIELDS[5]}"
}

function getMysqlBinary() {
  curl -sSL 'https://codeload.github.com/j-mcnally/mysql-binaries/tar.gz/master' | tar zxv
}

function showMysqlVersion() {
  mysql-binaries-master/bin/mysql --version
}

function importDatabase() {
  mysql-binaries-master/bin/mysql --verbose --user="${MYSQL_USER}" --password="${MYSQL_PASSWORD}" --host="${MYSQL_HOST}" --port="${MYSQL_PORT}" --database="${MYSQL_NAME}" < 'setup/mailtrain.sql'
}

function run() {
    setMysqlVariables
    getMysqlBinary
    showMysqlVersion
    importDatabase
}

run

#EOF
