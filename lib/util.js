/* jshint node: true */
'use strict';

var request = require('request');
var async   = require('async');

function getHostnameFromHost(host) {
  return host.split(':')[0];
}

function getPortFromHost(host) {
  return host.split(':')[1];
}

function healthCheckHost(hostname, port, fn) {
  var healthCheckUrl = 'http://' + hostname + ':' + port + '/ping';
  async.retry(10, function(fn) {
    setTimeout(function() {
      request(healthCheckUrl, function(err, res) {
        if (err) {
          return fn(err);
        }
        fn(null, res.statusCode == 200);
      });
    }, 2000);
  }, fn);
}

exports.getHostnameFromHost = getHostnameFromHost;
exports.getPortFromHost     = getPortFromHost;