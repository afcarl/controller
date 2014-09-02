'use strict';

var request = require('request');
var async   = require('async');

var DOCKER_PORT = 2375;

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

function getUnixTimestamp() {
  return Math.round(new Date().getTime() / 1000);
}

function getDockerUrl(host, path) {
  return 'http://' + host + ':' + DOCKER_PORT + '/' + path;
}

function parseDockerImage(image) {
  var parts = image.split(':');
  return {
    image: parts[0],
    tag: parts[1],
  };
}

exports.healthCheckHost = healthCheckHost;
exports.getUnixTimestamp = getUnixTimestamp;
exports.parseDockerImage = parseDockerImage;
