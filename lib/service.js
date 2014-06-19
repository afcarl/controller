/* jshint node: true */
'use strict';

var async    = require('async');
var _        = require('lodash');
var redisCmd = require('./redis');

function loadApps(fn) {
  redisCmd('smembers', 'domains', fn);
}

function loadAppEnvs(domain, fn) {
  redisCmd('smembers', domain + ':envs', fn);
}

function addAppEnv(domain, env, fn) {
  redisCmd('sadd', domain + ':envs', env, fn);
}

function removeAppEnv(domain, env, fn) {
  loadAppEnvs(domain, function(err, envs) {
    if (err) {
      return fn(err);
    }
    var matches = _.filter(envs, function(e) {
      return new RegExp('^' + env).test(e);
    });
    async.map(matches, function(match, fn) {
      redisCmd('srem', domain + ':envs', match, fn);
    }, fn);
  });
}

function loadAppInstances(domain, fn) {
  redisCmd('smembers', domain + ':hosts', fn);
}

function addAppInstance(domain, instance, fn) {
  redisCmd('sadd', domain + ':hosts', instance, fn);
}

function removeAppInstance(domain, instance, fn) {
  redisCmd('srem', domain + ':hosts', instance, fn);
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

exports.loadApps          = loadApps;
exports.loadAppEnvs       = loadAppEnvs;
exports.removeAppEnv      = removeAppEnv;
exports.loadAppInstances  = loadAppInstances;
exports.addAppInstance    = addAppInstance;
exports.removeAppInstance = removeAppInstance;
exports.loadHosts         = loadHosts;
exports.addHost           = loadHosts;
exports.removeHost        = removeHost;
