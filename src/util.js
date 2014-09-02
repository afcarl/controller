'use strict';

var request = require('request');
var async   = require('async');

var DOCKER_PORT = 2375;

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
    tag: parts[1] || '',
  };
}

exports.getUnixTimestamp = getUnixTimestamp;
exports.parseDockerImage = parseDockerImage;
exports.getDockerUrl = getDockerUrl;
