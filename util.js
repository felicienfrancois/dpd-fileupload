var fs = require('fs');
var path = require('path');

function fileExists(filePath, fn) {
    try {
        var stats = fs.statSync(filePath);
        fn(stats.isFile() || stats.isDirectory());
    } catch(err) {
        fn(false);
    }
}

function mkdirp(filePath, mode, cb) {
    var fn = cb || function() {};
    if (filePath.charAt(0) != "/") { 
        fn('Relative path: ' + filePath); 
        return;
    }
    var ps = path.normalize(filePath).split('/');
    fileExists(filePath, exists => {
        if (exists) {
            fn(null);
        } else mkdirp(ps.slice(0,-1).join('/'), mode, function (err) {
            if (err && err.errno != process.EEXIST) fn(err)
            else fs.mkdir(filePath, mode, fn);
        });
    });
}

exports.mkdirp = mkdirp;