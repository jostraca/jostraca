/* Copyright © 2019 Richard Rodger and other contributors, MIT License. */

const Pkg = require('./package.json')


module.exports = make_jostraca

function make_jostraca() {
  return new Jostraca()
}

function Jostraca() {
  var self = {}

  self.toString = function() {
    return 'jostraca@'+Pkg.version
  }
  
  
  return self
}
