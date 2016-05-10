'use strict';

/**
 * Module dependencies
 */
var	fs = require('fs'),
	mkdirp      = require('./util').mkdirp,
	util		= require('util'),
	path		= require('path'),
	publicDir	= "/../../public",
	debug		= require('debug')('dpd-fileupload'),
	formidable	= require('formidable'),
	md5			= require('md5'),
	mime		= require('mime'),

	Collection	= require('deployd/lib/resources/collection');

function Fileupload(name, options) {
	Collection.apply(this, arguments);
	
	// check to see if config has everything we need...
	// We will no longer need a config.properties
	// This 'should' be first run only, and shouldn't need to be saved...
	if (!this.config.directory || !this.config.fullDirectory) {
		var dir = "_" + name;
		
		this.config.directory = dir;
		// Config path is likely to be the best location to start from...
		this.config.fullDirectory = path.join(options.configPath || __dirname, publicDir, dir);
		
		this.config.authWrite = false;
		this.config.authRead = false;
		this.config.authDelete = false;
		this.config.authDeleteOwn = false;
		this.config.authUpdate = false;
		this.config.authUpdateOwn = false;
		
		// write the config file since it was apparently incomplete before
		fs.writeFile(path.join(options.configPath, 'config.json'), JSON.stringify(this.config), function(err) {
			if (err) throw err;
		});
	}
	
	// We need to make sure properties is at least an object
	if (!this.properties) {
		this.properties = {};
	}
	
	// Properties are now hard coded, we will not longer need a properties pages
	this.properties.type = this.properties.type || {type: 'string', required: true};
	this.properties.creationDate = this.properties.creationDate || {type: 'number', required: true};
	this.properties.subdir = this.properties.subdir || {type: 'string', required: false};
	this.properties.originalFilename = this.properties.originalFilename || {type: 'string', required: true};
	this.properties.filename = this.properties.filename || {type: 'string', required: true};
	this.properties.filesize = this.properties.filesize || {type: 'number'};
	// Track who uploaded the file, optional and only useful if authWrite is set to true
	this.properties.uploaderId = this.properties.uploaderId || {type: 'string', required: this.config.authWrite}
	
	// If the directory doesn't exist, we'll create it
	// try {
	// 	fs.statSync(this.config.fullDirectory).isDirectory();
	// } catch (er) {
		//fs.mkdir(this.config.fullDirectory);
		// mkdirp already does nothing if the directory already exists
		mkdirp(this.config.fullDirectory, (err) => {
			if (err) {
				console.log("Initial Creation Error: ", err);
			}
		})
	//}
}

util.inherits(Fileupload, Collection);

Fileupload.events = ["Get", "Post", "Delete", "Upload"];
Fileupload.clientGenerationGet = ['fileCount', 'totalFilesize']

// We will be using mostly a default dashboard, but we need to hack the rest to be default
Fileupload.dashboard = {
    path: path.join(__dirname, 'dashboard')
    , pages: ['Properties', 'Data', 'Events', 'API', 'Config', "Help"]
    , scripts: [
        '/../collection/js/lib/jquery-ui-1.8.22.custom.min.js'
        , '/../collection/js/lib/knockout-2.1.0.js'
        , '/../collection/js/lib/knockout.mapping.js'
        , '/../collection/js/util/knockout-util.js'
        , '/../collection/js/util/key-constants.js'
        , '/../collection/js/util.js'
    ]
};

// Make the config editable
Fileupload.basicDashboard = {
	settings: [
		{
			name: 'directory',
			type: 'text',
			description: 'The public directory that files are saved too. This file will be placed in the public directory. (default: _{ModuleName})'
		},
		{
			name: 'authRead',
			type: 'checkbox',
			description: 'Is the user required to be logged in to read Files (Not Implemented)'
		},
		{
			name: 'authReadOwn',
			type: 'checkbox',
			description: 'Is the user required to be logged in to read Files and only thier files. (Not Implemented)'
		},
		{
			name: 'authWrite',
			type: 'checkbox',
			description: 'Is the user required to be logged in to write Files'
		},
		{
			name: 'authDelete',
			type: 'checkbox',
			description: 'Is the user required to be logged in to delete Files'
		},
		{
			name: 'authDeleteOwn',
			type: 'checkbox',
			description: 'Is the user required to be logged in to delete Files, and Only their own files.'
		},
		{
			name: 'authUpdate',
			type: 'checkbox',
			description: 'Is the user required to be logged in to update Files (Not Implemented)'
		},
		{
			name: 'authUpdateOwn',
			type: 'checkbox',
			description: 'Is the user required to be logged in to update Files (Not Implemented)'
		}
	]
}

/**
 * Module methods
 */
Fileupload.prototype.handle = function (ctx, next) {
	ctx.query.id = ctx.query.id || this.parseId(ctx) || (ctx.body && ctx.body.id);
	var req = ctx.req,
		self = this;

	if (req.method === "POST") { // not clear what to do with PUTs yet...
		ctx.body = {};
		// Implement authWrite
		if(this.config.authWrite) {
			if (!(ctx.session && ctx.session.data && ctx.session.data.uid)) {
				return ctx.done("Must me authenticated to Post a new File");
			} else {
				ctx.body.uploaderId = ctx.session.data.uid;
			}
		}
		
		var form = new formidable.IncomingForm(),
			uploadDir = this.config.fullDirectory,
			resultFiles = [],
			remainingFile = 0;

		// Will send the response if all files have been processed
		var processDone = function(err, fileInfo) {
			if (err) return ctx.done(err);
			resultFiles.push(fileInfo);
			
			remainingFile--;
			if (remainingFile === 0) {
				console.log("Response sent: ", resultFiles);
				debug("Response sent: ", resultFiles);
				return ctx.done(null, resultFiles); // TODO not clear what to do here yet
			}
		};

		// If we received params from the request
		if (typeof req.query !== 'undefined') {
			for (var propertyName in req.query) {
				debug("Query param found: { %j:%j } ", propertyName, req.query[propertyName]);

				if (propertyName === 'subdir') {
					debug("Subdir found: %j", req.query[propertyName]);
					uploadDir = path.join(uploadDir, req.query.subdir);
					// If the sub-directory doesn't exists, we'll create it
					mkdirp(uploadDir, err => {
						console.log("Creation Error: ", err);
						return ctx.done("Error creating subdirectory " + uploadDir);
					});
					// try {
					// 	fs.statSync(uploadDir).isDirectory();
					// } catch (er) {
					// 	fs.mkdir(uploadDir);
					// }
				}
				
				ctx.body[propertyName] = req.query[propertyName];
			}
		}

		form.uploadDir = uploadDir;

		var renameAndStore = function(file) {
			fs.rename(file.path, path.join(uploadDir, file.name), function(err) {
				if (err) return processDone(err);
				debug("File renamed after event.upload.run: %j", err || path.join(uploadDir, file.name));
				
				ctx.body.filename = file.name;
				ctx.body.originalFilename = file.originalFilename;
				
				ctx.body.filesize = file.size;
				ctx.body.creationDate = new Date().getTime();

				// Store MIME type in object
				ctx.body.type = mime.lookup(file.name);
				
				self.save(ctx, processDone);
			});
		};

		form.parse(req)
			.on('file', function(name, file) {
				debug("File %j received", file.name);
				file.originalFilename = file.name;
				file.name = md5(Date.now()) + '.' + file.name.split('.').pop();
				var errors = {};
				
				var uploadDomain = self.createDomain(file, errors);
				//uploadDomain = {
					//file: file,
					//uploadDomainsetFilename: function (filename) {uploadDomain.file.name = filename;}
				//};
				
				//uploadDomain['this'] = file;
				//uploadDomain.data = file;
				
				//self.addDomainAdditions(uploadDomain);
				if (self.events.Upload) {
					self.events.Upload.run(ctx, uploadDomain, function(err) {
						if (err) {
							return ctx.done(err);
						} else {
							renameAndStore(uploadDomain.data);
						}
					})
				} else {
					renameAndStore(uploadDomain.data);
				}
			}).on('fileBegin', function(name, file) {
				remainingFile++;
				debug("Receiving a file: %j", file.name);
			}).on('error', function(err) {
				debug("Error: %j", err);
				return processDone(err);
			});
			
		return req.resume();
	} else if (req.method === "DELETE") {
		this.del(ctx, ctx.done);
	} else if (req.method === "PUT") {
		ctx.done({ statusCode: 400, message: "PUT not yet supported" });
	} else {
		Collection.prototype.handle.apply(this, [ctx, next]);
	}
};

// Delete a file
Fileupload.prototype.del = function(ctx, next) {
	var self = this;
	var uploadDir = this.config.fullDirectory;
	
	this.find(ctx, function(err, result) {
		if (err) return ctx.done(err);
		
		// Implement authDelete
		if(self.config.authDeleteOwn) {
			if (!(ctx.session && ctx.session.data && ctx.session.data.uid)) {
				return ctx.done("Please log into to Delete your files.");
			} else if (result.uploaderId && !(ctx.session.data.uid === result.uploaderId)) {
				return ctx.done("You can only delete your own files.");
			} else {
				return ctx.done("This file is not owned, ask admin to delete.");
			}
		} else if(self.config.authDelete) {
			if (!(ctx.session && ctx.session.data && ctx.session.data.uid)) {
				return ctx.done("Must me authenticated to Delete a File");
			}
		}
		
		// let the collection handle the store... we just care about the files themselves
		self.remove(ctx, function(err) {
			if (err) return ctx.done(err);
			
			if (typeof result == 'undefined')
				result = [];
			else if (!Array.isArray(result))
				result = [result];
			
			var filesRemaining = result.length;
			
			var finishedFcn = function(err) {
				if (err) return ctx.done(err);
				filesRemaining--;
				
				if (filesRemaining === 0) {
					var filenames = result.map(function(r) {
						return r.originalFilename;
					});
					next({statusCode: 200, message: "File " + filenames + " successfuly deleted"});
				}
			};
			
			result.forEach(function(toDelete) {
				var filepath;
				if (toDelete.subdir)
					filepath = path.join(uploadDir, toDelete.subdir, toDelete.filename);
				else
					filepath = path.join(uploadDir, toDelete.filename);
				
				// actually delete the file, let the Collection methods handle events and whatever else
				debug('deleting file',filepath);
				fs.unlink(filepath, finishedFcn);
			});
		});
	});
};

/**
 * Module export
 */
module.exports = Fileupload;
