
var should     = require('should');
var instances  = require('../src/instances');
var containers = require('../src/containers');

var DOCKER_HOST  = process.env.DOCKER_HOST;
var DOCKER_IMAGE = process.env.DOCKER_IMAGE;
var APP_NAME     = 'test';
var INSTANCE     = DOCKER_HOST + ':3000';

describe('instances', function() {

  describe('loadAppInstances', function() {

    before(function(done) {
      instances.addAppInstance(APP_NAME, INSTANCE, done);
    });

    after(function(done) {
      instances.removeAppInstance(APP_NAME, INSTANCE, done);
    });

    it('should return a list of instances', function(done) {
      instances.loadAppInstances(APP_NAME, function(err, _instances) {
        should.not.exist(err);
        _instances.should.containEql(INSTANCE);
        done();
      });
    });

  });

  describe('removeAppInstance', function() {

    before(function(done) {
      instances.addAppInstance(APP_NAME, INSTANCE, done);
    });

    it('should remove the instance', function(done) {
      instances.removeAppInstance(APP_NAME, INSTANCE, function(err) {
        should.not.exist(err);
        instances.loadAppInstances(APP_NAME, function(err, _instances) {
          should.not.exist(err);
          _instances.should.not.containEql(INSTANCE);
          done();
        });
      });
    });

  });

  describe('healthCheckInstance', function() {

    var containerId = null;

    before(function(done) {
      containers.runContainer(DOCKER_HOST, 3000, DOCKER_IMAGE, null, function(err, _containerId) {
        containerId = _containerId;
        setTimeout(function() {
          done(err);
        }, 1000); // waits for http-server to start
      });
    });

    after(function(done) {
      containers.deleteContainer(DOCKER_HOST, containerId, done);
    });

    it('should return a list of instances', function(done) {
      instances.healthCheckInstance(DOCKER_HOST, 3000, function(err, healthy) {
        should.not.exist(err);
        healthy.should.be.ok;
        done();
      });
    });

  });

});
