var _          = require('lodash');
var should     = require('should');
var containers = require('../src/containers');

var DOCKER_HOST  = process.env.DOCKER_HOST;
var DOCKER_IMAGE = process.env.DOCKER_IMAGE;

describe('containers', function () {
  describe('createContainer', function() {
    it('should create a new container', function(done) {
      var createOptions = {
        Image: DOCKER_IMAGE,
      };
      containers.createContainer(DOCKER_HOST, createOptions, function(err, result) {
        should.not.exist(err);
        result.should.have.property('Id');
        done();
      });
    });
  });

  describe('startContainer', function() {

    var containerId = null;

    before(function(done) {
      var createOptions = {
        Image: DOCKER_IMAGE,
      };
      containers.createContainer(DOCKER_HOST, createOptions, function(err, result) {
        containerId = result.Id;
        done(err);
      });
    });

    it('should start the container and return status', function(done) {
      containers.startContainer(DOCKER_HOST, containerId, {}, function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('createAndStartContainer', function() {
    it('should create a new container and start it', function(done) {
      var createOptions = {
        Image: DOCKER_IMAGE,
      };
      containers.createAndStartContainer(DOCKER_HOST, 9000, createOptions, function(err, result) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('loadContainers', function() {

    var containerId = null;

    before(function(done) {
      containers.runContainer(DOCKER_HOST, 3030, DOCKER_IMAGE, {}, function(err, _containerId) {
        containerId = _containerId;
        done(err);
      });
    });

    it('should return a list of all containers', function(done) {
      containers.loadContainers(DOCKER_HOST, function(err, _containers) {
        should.not.exist(err);
        var match = _.find(_containers, {Id: containerId});
        match.should.have.property('Id', containerId);
        done();
      });
    });

  });

});
