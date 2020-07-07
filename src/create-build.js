import glob from "fast-glob";
import path from "path";
import {
    isJs,
    isFixLink,
    writeFile,
    normalizePath,
    logger,
    request as uRequest,
    readFile as fsReadFile,
    isHtml,
} from "./utils/utils";
import { createServer } from "./create-server";
import { createWatch } from "./create-watch";
import { loadOptions } from "./load-options";
import { loadBuild } from "./load-build";

let CACHE_REQUEST = {};
/**
 * @param {import("./internal").options} options
 */
export async function createBuild(options) {
    options = await loadOptions(options);

    let loadReady = logger.load();

    let cycleBuild = 0;

    let files = await glob(options.src);

    /**@type {import("./internal").server} */
    let server;

    /**@type {import("./internal").reload} */
    let reload = () => {};

    let inputs = {};

    let cache = {};

    /**@type {import("./internal").getCache} */
    let getCache = (prop) => (cache[prop] = cache[prop] = {});

    let CacheReadFile = Symbol("_cacheReadFile");

    /**@type {import("./internal").readFile} */
    let readFile = (file) => {
        let cache = getCache(CacheReadFile);
        return (cache[file] = cache[file] || fsReadFile(file));
    };

    /**@type {import("./internal").isPreventLoad} */
    let isPreventLoad = (file) => file in inputs;

    /**@type {import("./internal").isNotPreventLoad} */
    let isNotPreventLoad = (file) => !isPreventLoad(file);

    /**@type {import("./internal").fileWatcher} */
    let fileWatcher = () => {};

    /**@type {import("./internal").isForCopy} */
    let isForCopy = (file) => !options.assetsWithoutHash.test(file);

    /**@type {import("./internal").request}*/
    let request = (url) =>
        (CACHE_REQUEST[url] = CACHE_REQUEST[url] || uRequest(url));

    /**@type {import("./internal").deleteInput} */
    function deleteInput(file) {
        delete getCache(CacheReadFile)[file];
        delete inputs[file];
        return file;
    }

    /**@type {import("./internal").getDestDataFile} */
    function getDestDataFile(file) {
        let { name, ext, dir } = path.parse(file);

        ext = isJs(ext) ? ".js" : isHtml(ext) ? ".html" : ext || ".html";

        let typeHtml = ext == ".html";

        let isIndex = typeHtml && name == "index";

        if (!options.assetsWithoutHash.test(ext)) {
            let data = {
                hash:
                    "" +
                    file
                        .split("")
                        .reduce((out, i) => (out + i.charCodeAt(0)) | 8, 4),
                name,
            };

            name = options.assetHashPattern.replace(
                /\[([^\]]+)\]/g,
                (all, prop) => data[prop] || ""
            );

            if (name.indexOf(data.hash) == -1) {
                name = data.hash + "-" + name;
            }
        }

        dir = typeHtml ? dir : options.assetsDir;

        let dest = normalizePath(path.join(options.dest, dir, name + ext));

        let link = normalizePath(
            path.join(
                options.href,
                dir,
                isIndex ? "./" : name + (typeHtml ? "" : ext)
            )
        );

        let base = name + ext;

        return {
            base,
            name,
            link,
            dest,
        };
    }

    /**@type {import("./internal").preventNextLoad} */
    function preventNextLoad(file) {
        if (file in inputs) {
            return false;
        } else {
            return (inputs[file] = true);
        }
    }

    /**@type {import("./internal").mountFile} */
    function mountFile({ dest, code, type, stream }) {
        if (options.virtual) {
            server.sources[dest] = { code, stream, type };
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
                loadBuild(build, files, cycleBuild++, forceBuild);
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

    loadReady();

    /**@type {import("./internal").build} */
    let build = {
        inputs,
        options,
        getCache,
        readFile,
        isPreventLoad,
        isNotPreventLoad,
        deleteInput,
        preventNextLoad,
        mountFile,
        fileWatcher,
        getDestDataFile,
        isForCopy,
        request,
        logger: {
            ...logger,
            async markBuild(...args) {
                await logger.markBuild(...args);
                reload();
            },
        },
    };

    return loadBuild(build, files, cycleBuild++);
}
