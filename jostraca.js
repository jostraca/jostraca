/* Copyright © 2019 Richard Rodger and other contributors, MIT License. */
var Pkg = require('./package.json')
var Seneca = require('seneca')
module.exports = make_jostraca
function make_jostraca() {
  return Jostraca()
}
function Jostraca() {
  var self = {}
  self.toString = function () {
    return 'jostraca@' + Pkg.version
  }
  self['seneca'] = Seneca()
  return self
}
