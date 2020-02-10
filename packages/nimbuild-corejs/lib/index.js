// 3rd party
const browserslist = require('browserslist');
const Fs = require('fs').promises;
const Path = require('path');
// user
const {LOG_ERROR} = require('./constants');
const {getModules} = require('./module-resolver');
const {
    addSupported,
    getSupported,
    getBaseFeatureModules
} = require('./supported-sets');
const webpacknimbuild = require('@vrbo/nimbuild-webpack')({
    maxLength: 100000
});

/**
 * getPolyfillString()
 * Function that generates a coreJS polyfill string given a user agent string and minify flag
 * @param {string} options.baseFeatureSet - REQUIRED. base feature set of coreJS polyfills to provide (IE "default")
 * @param {object} options.logger - Logging object to implement logging.  Requires a "log()" API
 * @param {bool} options.minify - flag on whether or not to compress assets
 * @param {string} options.overrideTargetPlatform - optional param.  Used by cache primer to directly specify a browserlist query to invoke LRU cache mechanism
 * @param {string} options.uaString - User agent string of incoming HTTP logger.
 */
async function getPolyfillString({
    include,
    exclude,
    logger,
    minify,
    overrideTargetPlatform,
    uaString
}) {
    // Resolve base feature set based on include / exclude
    const features = getBaseFeatureModules({
        include,
        exclude
    });

    // Resolve modules
    const modules = getModules({
        features,
        uaString,
        logger,
        overrideTargetPlatform
    });

    // Calculate webpack entry
    const entry = modules.corejs
        .map((it) => `core-js/modules/${it}`)
        .concat(modules.normal);
    try {
        const response = await webpacknimbuild.run({
            entry,
            minify,
            modifyScript: (script) => {
                // Wrap response
                return `!function (undefined) { 'use strict'; ${script} }();`;
            }
        });
        return response;
    } catch (err) {
        logger.log(
            LOG_ERROR,
            `getPolyfillString webpack compile exception: "${err.message}".`
        );
        throw new Error(err);
    }
}

/**
 * primeCache()
 * Initializes LRU cache for optimal run-time performance
 * @param {object} logger - REQUIRED.  logger object (must implement log() API)
 */
async function primeCache(logger) {
    // Get all target platforms
    const browsers = browserslist('> 0%');
    browsers.push('defaults');
    const start = Date.now();
    logger.log(
        'priming known coreJS polyfills...',
        Object.keys(getSupported())
    );
    const featureSets = Object.keys(getSupported());
    for (let i = 0; i < featureSets.length; i++) {
        const featureSet = featureSets[i];
        const {include, exclude} = getSupported(featureSet);
        for (let j = 0; j < browsers.length; j++) {
            const browser = browsers[j];
            await getPolyfillString({
                include,
                exclude,
                logger: {
                    log: () => {}
                },
                minify: true,
                overrideTargetPlatform: browser
            });
        }
        logger.log(
            `finished priming ${featureSet} in ${Date.now() -
                start}ms (cache now has ${
                webpacknimbuild.cache.keys().length
            } entries)`
        );
    }
    return webpacknimbuild.cache.keys().length;
}

/**
 * Serializes the cache's entries as JSON files in the provided directory.
 * @param directory
 * @returns {Promise<unknown[]>}
 */
async function serializeCache(directory) {
    const promises = [];

    webpacknimbuild.cache.keys().forEach((key) => {
        const entry = webpacknimbuild.cache.get(key);
        const serializedEntry = JSON.stringify(entry);
        const filepath = Path.resolve(directory, `${key}.json`);
        const promise = Fs.writeFile(filepath, serializedEntry);

        promises.push(promise);
    });

    return await Promise.all(promises);
}

/**
 * Deserializes the cache from the JSON files in the provided directory.
 * @param directory
 * @returns {Promise<unknown[]>}
 */
async function deserializeCache(directory) {
    const files = await Fs.readdir(directory);
    const promises = [];

    async function deserialize(directory, file) {
        const fullPath = Path.resolve(directory, file);
        const key = Path.basename(file, '.json');
        const serializedEntry = await Fs.readFile(fullPath, 'utf8');
        const entry = JSON.parse(serializedEntry);

        webpacknimbuild.cache.set(key, entry);
    }

    files.forEach((file) => {
        const promise = deserialize(directory, file);
        promises.push(promise);
    });

    return await Promise.all(promises);
}

module.exports = {
    getPolyfillString,
    addSupported,
    getSupported,
    primeCache,
    clearCache: () => {
        webpacknimbuild.cache.reset();
    },
    getCache: () => webpacknimbuild.cache,
    serializeCache,
    deserializeCache
};
