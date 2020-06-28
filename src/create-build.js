import glob from "fast-glob";
import path from "path";
import {
    isJs,
    isMd,
    isFixLink,
    writeFile,
    normalizePath,
    logger,
    npmRun,
    readFile as fsReadFile,
} from "./utils/utils";
import { createServer } from "./create-server";
import { createWatch } from "./create-watch";
import { loadOptions } from "./load-options";
import { loadBuild } from "./load-build";

export async function createBuild(options) {
    options = await loadOptions(options);

    let loadReady = logger.load();

    let files = await glob(options.src);

    let server;

    let reload = () => {};

    let inputs = {};

    let cache = {};

    let getCache = (prop) => (cache[prop] = cache[prop] = {});

    let CacheReadFile = Symbol("_cacheReadFile");

    let readFile = (file) => {
        let cache = getCache(CacheReadFile);
        return (cache[file] = cache[file] || fsReadFile(file));
    };

    let getLink = (path) => normalizePath(options.href + path);

    let getDest = (file, folder = "") =>
        normalizePath(path.join(options.dest, folder, file));

    let isPreventLoad = (file) => file in inputs;

    let isNotPreventLoad = (file) => !isPreventLoad(file);

    let footerLog = logger.footer("");

    let fileWatcher = () => {};

    function deleteInput(file) {
        delete getCache(CacheReadFile)[file];
        delete inputs[file];
        return file;
    }

    /**
     * gets the file name based on its type
     * @param {string} file
     */
    function getFileName(file) {
        let { name, ext } = path.parse(file);

        return normalizePath(
            isFixLink(ext)
                ? name + (isJs(ext) ? ".js" : isMd(ext) ? ".html" : ext)
                : file
                      .split("")
                      .reduce((out, i) => (out + i.charCodeAt(0)) | 8, 4) +
                      "-" +
                      name +
                      ext
        );
    }

    /**
     * prevents the file from working more than once
     * @param {string} file
     */
    function preventNextLoad(file) {
        if (file in inputs) {
            return false;
        } else {
            return (inputs[file] = true);
        }
    }

    function mountFile({ dest, code, type, stream }) {
        if (options.virtual) {
            server.sources[dest] = { code, stream, type, stream };
        } else {
            return writeFile(dest, code);
        }
    }

    if (options.server) {
        try {
            server = await createServer({
                root: options.dest,
                port: options.port,
                reload: options.watch,
                proxy: options.proxy,
            });
            reload = server.reload;
        } catch (e) {
            console.log(e);
        }

        logger.header(`Server running on http://localhost:${server.port}`);
    }

    if (options.watch) {
        // map defining the cross dependencies between child and parents
        let mapSubWatch = {};

        let watcher = createWatch(options.src, (group) => {
            let files = [];
            let forceBuild;

            if (group.add) {
                let groupFiles = group.add
                    .filter(isFixLink)
                    .filter(isNotPreventLoad);
                files = [...files, ...groupFiles];
            }
            if (group.change) {
                let groupChange = group.change.filter((file) => !isJs(file)); // ignore js file changes

                let groupFiles = [
                    ...groupChange, // keep files that have changed in the queue
                    ...groupChange // add new files based on existing ones in the queue
                        .filter((file) => mapSubWatch[file])
                        .map((file) =>
                            Object.keys(mapSubWatch[file]).filter(
                                (subFile) => mapSubWatch[file][subFile]
                            )
                        )
                        .flat(),
                ]
                    .filter(isPreventLoad)
                    .map(deleteInput);

                files = [...files, ...groupFiles];
            }

            if (group.unlink) {
                group.unlink.forEach(deleteInput);
                forceBuild = true;
            }

            if (files.length || forceBuild) {
                loadBuild(build, files, forceBuild);
            }
        });

        fileWatcher = (file, parentFile, rebuild) => {
            if (!mapSubWatch[file]) {
                mapSubWatch[file] = {};
                watcher.add(file);
            }
            if (parentFile) {
                mapSubWatch[file][parentFile] = rebuild;
            }
        };
    }

    let build = {
        inputs,
        options,
        getCache,
        readFile,
        getLink,
        getDest,
        isPreventLoad,
        isNotPreventLoad,
        deleteInput,
        getFileName,
        preventNextLoad,
        mountFile,
        footerLog,
        fileWatcher: fileWatcher,
        logger: {
            ...logger,
            markBuild(...args) {
                logger.markBuild(...args);
                reload();
            },
        },
    };

    loadReady();

    loadBuild(build, files);
}
