/* jshint node: true */
'use strict';

var request = require('request');
var async   = require('async');

function healthCheckHost(hostname, port, fn) {
  var healthCheckUrl = 'http://' + hostname + ':' + port + '/ping';
  async.retry(10, function(fn) {
    request({
      url: healthCheckUrl,
      timeout: 5000,
    }, function(err, res) {
      if (err) {
        fn(null, false);
      } else {
        fn(null, res.statusCode == 200);
      }
    });
  }, fn);
}

exports.healthCheckHost = healthCheckHost;
