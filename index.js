var path = require('path');

//
// Inspired by
// https://github.com/rails/rails/blob/master/railties/lib/rails/generators.rb
// module
//
// Super simplified here.

var generators = module.exports;

// hoist up top level class the generator extend
generators.Base = require('./base');
generators.NamedBase = require('./named-base');


// backward compat, make them available as generators.generators.Base &
// NamedBase (as most of generators use yeoman.generators.Stuff)
generators.generators = {};
generators.generators.Base = generators.Base;
generators.generators.NamedBase = generators.NamedBase;

// hidden namespaces don't show up in the help output
// XXX hidden namespaces for now means app context, should we filter them
// automatically in help output?
generators.hiddenNamespaces = [
  'yeoman:app',
  'yeoman:js',
  'sass:app',
  'jasmine:app',
  /*jshint scripturl:true */
  'mocha:app'
];

// keep track of loaded path in lookup case no generator were found, to be able to
// log where we searched
generators.loadedPath = [];

// parse out `grunt.cli` for arguments and options and do the necessary
// conversion to avoid some warnings and built-in help/version output when
// grunt initialiaze.
generators.prepare = function prepare(grunt) {
  var cli = grunt.cli;

  generators.args = cli.tasks.slice(1);
  generators.name = generators.args.shift();
  generators.options = grunt.util._.extend({}, cli.options);

  // Don't complain about missing Gruntfile, we want all positional arguments
  // as is to be passed to generators. the `init:` prefix workarounds this
  // Gruntfile check internally by Grunt, letting us getting into the Grunt
  // init yeoman template, which then init and delegate the groundwork to the
  // generator layer, where those `init:thing` are stripped out again.
  cli.tasks = cli.tasks.map(function(arg) {
    return arg === 'init' ? 'init:yeoman' :
      'init:' + arg;
  });

  // prevent special flags like --help to conflict with generators options.
  cli.options.help = false;
};

// Main entry point of the generator layer, requires a Grunt object from which
// we read cli options and tasks, and kick off the appropriate generator.
generators.init = function init(grunt) {
  var args = generators.args,
    name = generators.name,
    opts = generators.options;

  generators.setup(grunt);

  if(!name) {
    // no generator to invoke, output the general help output
    return generators.help(args, opts, grunt.config() || {});
  }

  // and invoke
  return generators.invoke(name, args, opts, grunt.config() || {});
};

// Setup the generator layer and integrate into Grunt state.
//
// Setup the `cwd`, `gruntfie`, `base` property on the generator module,
// walking up the file system to search for a valid Gruntfile, and init the
// grunt configuration.
//
// Change directory to the application Gruntfile dirname, if found.
//
// Loads up any `yeoman-*` plugin in the node_modules directory, next to the
// Gruntfile if found, or relative to current directory.
generators.setup = function setup(grunt) {
  // figure out the base application directory
  generators.cwd = process.cwd();
  generators.gruntfile = grunt.file.findup(generators.cwd, '{G,g}runtfile.{js,coffee}');
  generators.base = generators.gruntfile ? path.dirname(generators.gruntfile) : generators.cwd;

  // keep reference to this grunt object, so that other method of this module may use its API.
  generators.grunt = grunt;

  // when a Gruntfile is found, make sure to cdinto that path. This is the
  // root of the yeoman app (should probably check few other things too, this
  // gruntfile may be in another project up to this path), otherwise let the
  // default cwd be (mainly for app generator).
  if(generators.gruntfile) {
    // init the grunt config if a Gruntfile was found
    try {
      require(generators.gruntfile).call(grunt, grunt);
    } catch( e ) {
      grunt.log.write( e.message ).error().verbose.error( e.stack) .or.error( e );
    }

    // and cd into that base, all generators should write relative to the
    // application root.
    process.chdir(generators.base);
  }

  // try to locate locally installed yeoman plugin
  generators.plugins = grunt.file.expandDirs('node_modules/yeoman-*');

  // and built-in one in yeoman packages, within one of its npm deps
  // XXX: this is clumpsy, works specifically for yeoman and when
  // yeoman-generators is one of the top level deps.
  generators.plugins = generators.plugins.concat(__dirname);

  return generators;
};

// show help message with available generators
generators.help = function help(args, options, config) {
  var internalPath = path.join(__dirname, '../..'),
    internal = generators.lookupHelp(internalPath, args, options, config),
    users = generators.lookupHelp(process.cwd(), args, options, config),
    grunt = generators.grunt;

  // try load in any node_modules/yeoman-*/lib/generators too
  var plugins = generators.plugins.map(function(plugin) {
    return generators.lookupHelp(path.resolve(plugin), args, options, config);
  }).reduce(function(a, b) {
    a = a.concat(b);
    return a;
  }, []);

  // group them all together
  var all = users.concat(plugins).concat(internal);

  // sort out the namespaces
  var namespaces = all.map(function(generator) {
    return generator.namespace;
  });

  // ensure we don't help loaded twice generator
  namespaces = grunt.util._.uniq(namespaces);

  // filter hidden namespaces
  namespaces = namespaces.filter(function( ns ) {
    return generators.hiddenNamespaces.indexOf( ns ) === -1;
  });

  // group them by namespace
  var groups = {};
  namespaces.forEach(function(namespace) {
    var base = namespace.split(':')[0];

    if ( !groups[ base ] ) {
      groups[ base ] = [];
    }

    groups[base] = groups[base].concat(namespace);
  });

  // default help message
  var out = [
    'Usage: yeoman generate GENERATOR [args] [options]',
    '',
    'General options:',
    '  -h, --help     # Print generator\'s options and usage',
    // XXX below are options that are present in rails generators we might want
    // to handle
    // '  -p, [--pretend]  # Run but do not make any changes',
    // '  -f, [--force]    # Overwrite files that already exist',
    // '  -s, [--skip]     # Skip files that already exist',
    // '  -q, [--quiet]    # Suppress status output',
    '',
    'Please choose a generator below.',
    ''
  ].join('\n');

  console.log(out);

  // strip out the yeoman base namespace
  groups.yeoman = (groups.yeoman || []).map(function(ns) {
    return ns.replace(/^yeoman:/, '');
  });

  // print yeoman default first
  generators.printList('yeoman', groups.yeoman);
  Object.keys(groups).forEach(function(key) {
    if ( key === 'yeoman' ) {
      return;
    }
    generators.printList(key, groups[key]);
  });
};

// Prints a list of generators.
generators.printList = function printList(base, namespaces) {
  // should use underscore.string for humanize, camelize and so on.
  console.log( base.charAt(0).toUpperCase() + base.slice(1) + ':' );
  namespaces.forEach(function(ns) {
    console.log('  ' + ns);
  });
  console.log();
};

// Receives a namespace, arguments and the options list to invoke a generator.
// It's used as the default entry point for the generate command.
generators.invoke = function invoke(namespace, args, options, config, cb) {
  // noop when no async handler provided
  cb = cb || function() {};

  // keep track of loaded path in lookup case no generator were found, to be able to
  // log where we searched
  // reset the loadedPath on invoke
  generators.loadedPath = [];

  // create the given generator
  var generator = generators.create(namespace, args, options, config);

  // unable to find one
  if(!generator) {
    console.log('Could not find generator', namespace);
    return console.log('Tried in:\n' + generators.loadedPath.map(function(path) {
      return ' - ' + path;
    }).join('\n'));
  }

  // configure the given sourceRoot for this path, if it wasn't already in the
  // Generator constructor.
  if(!generator.sourceRoot()) {
    generator.sourceRoot(path.join(generator.generatorPath, 'templates'));
  }

  // validate the generator (show help on missing argument / options)
  var requiredArgs = generator._arguments.some(function(arg) {
    return arg.config && arg.config.required;
  });

  if(!args.length && requiredArgs) {
    return console.log( generator.help() );
  }

  // also show help if --help was specifically passed
  if(options.help) {
    return console.log( generator.help() );
  }

  generators.grunt.log.subhead('.. Invoke ' + namespace.replace(/^yeoman:/, '') + ' ..');
  // and start if off
  return generator.run(args, cb);
};

// Generator factory. Get a namespace, locate, instantiate, init and return the
// given generator.
generators.create = function create(namespace, args, options, gruntConfig) {
  var names = namespace.split(':'),
    name = names.pop(),
    Klass = generators.findByNamespace(name, names.join(':'));

  // try by forcing the yeoman namespace, if none is specified
  if(!Klass && !names.length) {
    Klass = generators.findByNamespace(name, 'yeoman');
  }

  // if it still hasnt been found, search for an "all" subgenerator
  if(!Klass && !names.length) {
    Klass = generators.findByNamespace([name, 'all'].join(':'));
  }


  if ( !Klass ) {
    return;
  }

  // create a new generator from this class
  var generator = new Klass(args, options, gruntConfig);

  // hacky, might change.
  // attach the invoke helper to the generator instance
  generator.invoke = generators.invoke;

  // and few other informations
  generator.namespace = Klass.namespace;
  generator.generatorName = name;
  generator.generatorPath = Klass.path;

  // follup registered hooks, and instantiate each resolved generator
  // so that we can get access to expected arguments / options
  generator._hooks = generator._hooks.map(function(hook) {
    var config = gruntConfig.generator || {},
      resolved = options[hook.name] || config[hook.name];

    hook.context = resolved + ':' + (hook.as || name);
    hook.args = hook.args || args;
    hook.config = hook.config || config;
    hook.options = hook.options || options;
    hook.generator = generators.create(hook.context, hook.args, hook.options, hook.config, true);
    return hook;
  });

  return generator;
};

//
// Yeoman finds namespaces by looking up special directories, and namespaces
// are directly tied to their file structure.
//
//    findByNamespace('jasmine', 'yeoman')
//
// Will search for the following generators:
//
//    "yeoman:jasmine", "jasmine"
//
// Which in turns look for these paths in the load paths:
//
//    generators/yeoman/jasmine/index.js
//    generators/yeoman/jasmine.js
//
//    generators/jasmine/index.js
//    generators/jasmine.js
//
// Load paths include `lib/` from within the yeoman application (user one), and
// the internal `lib/yeoman` path from within yeoman itself.
//
generators.findByNamespace = function findByNamespace(name, base) {
  var lookups = base ? [base + ':' + name , base] : [name];

  // first search locally, ./lib/generators
  var generator = generators.lookup(lookups);

  if(!generator) {
    // then try in each yeoman plugin
    generators.plugins.forEach(function(plugin) {
      generator = generator || generators.lookup(lookups, path.resolve(plugin));
    });
  }

  if(!generator) {
    // finally try in yeoman's bultin
    generator = generators.lookup(lookups, path.join(__dirname, '../..'));
  }

  return generator;
};

// Receives namespaces in an array and tries to find matching generators in the
// load paths. Load paths include both `yeoman/generators` and `generators`, in
// both the relative-to-gruntfile-directory `./lib/` and yeoman's built-in
// generators `lib/generators`.
generators.lookup = function lookup(namespaces, basedir) {
  var paths = generators.namespacesToPaths(namespaces),
    generator;

  basedir = basedir || generators.base;

  paths.forEach(function(rawPath) {
    if ( generator ) {
      return;
    }

    ['yeoman/generators', 'generators'].forEach(function(base) {
      var path = [basedir, 'lib', base, rawPath].join('/');

      try {
        // keep track of loaded path
        if ( generators.loadedPath ) {
          generators.loadedPath.push( path );
        }
        // console.log('>>', namespaces, 'search in ', path);
        generator = require(path);
        // dynamically attach the generator filepath where it was found
        // to the given class, and the associated namespace
        generator.path = path;
        generator.namespace = rawPath.split('/').join(':');

      } catch(e) {
        // not a loadpath error? bubble up the exception
        if ( e.message.indexOf( path ) === -1 ) {
          throw e;
        }
      }
    });
  });

  return generator;
};

// This will try to load any generator in the load path to show in help.
//
// XXX Note may end up in the convention than rails, with generator named after
// {name}_generator.js pattern. Easier for path lookup. Right now, generators
// are stucked with the `index.js` name.
generators.lookupHelp = function lookupHelp(basedir, args, options, config) {
  var grunt = generators.grunt;

  basedir = basedir || generators.base;

  var found = ['yeoman/generators', 'generators'].map(function(p) {
    var prefix = path.join(basedir, 'lib', p),
      pattern = path.join(prefix, '**', 'index.js'),
      files = grunt.file.expandFiles(pattern);

    // don't load up under special path, like an immediate `templates/` dirname
    files = files.filter(function(file) {
      return path.basename(path.dirname(file)) !== 'templates';
    });

    return files.map(function(filepath) {
      var shorten = filepath.slice(prefix.length + 1),
        namespace = shorten.split(path.join('/')).slice(0, -1).join(':'),
        mod;

      try {
        mod = require(filepath);
      } catch(e) {
        if(!(/Cannot find module ['"]yeoman['"]/.test(e.message))) {
          // not a yeoman loading issue? bubble up the exception
          throw e;
        }

        console.log('[Error] loading generator at', filepath);
        console.log('Make sure you have the yeoman module installed locally:');
        console.log();
        console.log('  npm install yeoman');
        console.log();
        console.log();
      }

      return {
        root: prefix,
        path: shorten,
        fullpath: filepath,
        module: mod,
        namespace: namespace
      };
    });
  });

  // reduce it down to a single array
  found = found.reduce(function(a, b) {
    a = a.concat(b);
    return a;
  }, []);

  // filter out non generator based module
  found = found.filter(function(generator) {
    if ( typeof generator.module !== 'function' ) {
      return false;
    }
    generator.instance = new generator.module(args, options, config);
    return generator.instance instanceof generators.Base;
  }).sort(function(a, b) {
    return a.namespace < b.namespace;
  });

  // and ensure we won't return same generator on different namespace
  var paths = [];
  return found.filter(function(generator) {
    var known = paths.indexOf( generator.fullpath ) === -1;
    paths.push(generator.fullpath);
    return known;
  });
};

// Convert namespaces to paths by replacing ":" for "/".
generators.namespacesToPaths = function namespacesToPaths(namespaces) {
  return namespaces.map(function(namespace) {
    return namespace.split(':').join('/');
  });
};

// Returns the list of files generated by a generator, can be glob patterns.
//
// Used to setup the Grunt init template warnOn property at runtime.
generators.warnOn = function warnOn(grunt) {
  // name of the generator to invoke, as resolved in prepare step
  var name = generators.name || '';
  // options, from grunt.cli
  var opts = generators.options;
  // generator arguments, from grunt.cli.tasks minus generator name
  var args = generators.args;
  // Grunt config, from gruntfile
  var config = grunt.config() || {};

  // Attempt to locate and create the generator
  var generator = generators.setup(grunt).create(name, args, opts, config);

  // invalid generator, or empty warnings warn on nothing
  return generator && generator._warns.length ? generator._warns : '';
};
