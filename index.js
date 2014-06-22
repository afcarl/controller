/* jslint node: true */
'use strict';

var app  = require('./lib/app');
var PORT = process.env.PORT || 3000;

app.listen(PORT, function() {
  console.log('Listening on port ' + PORT);
});

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err, err.stack);
  process.exit(1);
});
