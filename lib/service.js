/* jshint node: true */
'use strict';

var async    = require('async');
var _        = require('lodash');
var redisCmd = require('./redis');

function loadApps(fn) {
  redisCmd('smembers', 'apps', fn);
}

function loadAppEnvs(app, fn) {
  redisCmd('smembers', app + ':envs', fn);
}

function addAppEnv(app, env, fn) {
  redisCmd('sadd', app + ':envs', env, fn);
}

function removeAppEnv(app, env, fn) {
  loadAppEnvs(app, function(err, envs) {
    if (err) {
      return fn(err);
    }
    var matches = _.filter(envs, function(e) {
      return new RegExp('^' + env).test(e);
    });
    async.map(matches, function(match, fn) {
      redisCmd('srem', app + ':envs', match, fn);
    }, fn);
  });
}

function loadAppInstances(app, fn) {
  redisCmd('smembers', app + ':instances', fn);
}

function addAppInstance(app, instance, fn) {
  redisCmd('sadd', app + ':instances', instance, fn);
}

function removeAppInstance(app, instance, fn) {
  redisCmd('srem', app + ':instances', instance, fn);
}

function loadHosts(fn) {
  redisCmd('smembers', 'hosts', fn);
}

function addHost(host, fn) {
  redisCmd('sadd', 'hosts', host, fn);
}

function removeHost(host, fn) {
  redisCmd('srem', 'hosts', host, fn);
}

function notifyRouter(fn) {
  redisCmd('publish', 'updates', ''+new Date().getTime(), fn);
}

exports.loadApps          = loadApps;
exports.loadAppEnvs       = loadAppEnvs;
exports.removeAppEnv      = removeAppEnv;
exports.loadAppInstances  = loadAppInstances;
exports.addAppInstance    = addAppInstance;
exports.removeAppInstance = removeAppInstance;
exports.loadHosts         = loadHosts;
exports.addHost           = loadHosts;
exports.removeHost        = removeHost;
