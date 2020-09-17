import { Plugin, OptionsBuild, Files } from "estack";
import glob from "fast-glob";
import { Load } from "./build/types";
import { createBuild } from "./build/create-build";
import { loadOptions } from "./build/load-options";
import { createWatch } from "./build/create-watch";
import { log } from "./utils/log";
import { createMarks } from "./utils/mark";
import { pluginsParallel, pluginsSequential } from "./build/plugins";
import { pluginData } from "./plugins/data";
import { pluginHtml } from "./plugins/html";
import { pluginServer } from "./plugins/server";
import { pluginCss } from "./plugins/css";
import { pluginJs } from "./plugins/js";
import { pluginWrite } from "./plugins/write";

interface CyclesTask {
    [index: number]: Promise<void>[];
}

export async function build(opts: OptionsBuild) {
    const mark = createMarks();

    log({
        message: "[time] [bold $][bold.green $]",
        params: ["loading", "..."],
    });

    mark("build");

    const cyclesTask: CyclesTask = {};
    let cyclesTaskCount = 0;

    const options = await loadOptions(opts);

    const listSrc = await glob(options.glob);

    const plugins: Plugin[] = [
        pluginHtml(),
        pluginData(),
        pluginCss(),
        pluginJs(),
        options.server ? pluginServer() : pluginWrite(options.dest),
    ];

    /**
     * Load loads files into plugins for manipulation
     */
    const load: Load = async (file) => {
        if (file.assigned || !file.load) return;
        /**
         * Clean the errors to check if they have been corrected
         */
        file.errors = [];
        /**
         * Avoid reassignments to plugins from the file
         */
        file.assigned = true;
        /**
         * Plugins that manipulate types run sequentially
         */
        const pipe = plugins.filter((plugin) =>
            plugin.filter ? plugin.filter(file) : false
        );
        if (pipe.length) {
            await pipe.reduce(
                (promise, plugin) =>
                    promise.then(() => {
                        plugin.loads++;
                        return plugin.load(file, build);
                    }),
                Promise.resolve()
            );
        }
    };

    /**
     * The cycles are parallel processes sent from the build,
     * the cyclos communicate to the plugin the status of the build
     * @param src
     */
    const rebuild = async (src: string[] = []) => {
        const cycleTaskId = ++cyclesTaskCount;
        const closeMark = mark("build");
        console.log("");
        log({
            message: `[time] [bold $][bold.green $]`,
            params: ["Build start", "..."],
        });

        plugins.forEach((plugin) => (plugin.loads = 0));
        await pluginsSequential("buildStart", plugins, build);
        await pluginsParallel("beforeLoad", plugins, build);
        // Create a subtask of unresolved processes in the main load
        cyclesTask[cycleTaskId] = [];
        await Promise.all(
            src.map(async (src) => {
                const file = build.addFile(src, {
                    root: true,
                });

                return load(file);
            })
        );
        // Wait for the subtasks to finish to run correctly the plugin cylco
        await Promise.all(cyclesTask[cycleTaskId]);
        // Clean up tasks
        delete cyclesTask[cycleTaskId];
        await pluginsParallel("afterLoad", plugins, build);
        await pluginsSequential("buildEnd", plugins, build);

        let errors = 0;
        let files = 0;
        for (let src in build.files) {
            files++;
            const file = build.files[src];
            if (file.errors.length) {
                if (!errors) console.log("");
                errors += file.errors.length;
                log({
                    items: [
                        {
                            message: file.src,
                            items: file.errors.map((message) => ({
                                message,
                            })),
                        },
                    ],
                });
            }
        }

        if (errors) console.log("");

        log({
            message: `[time] [bold.green $], Files with errors ${
                errors ? "[bold.red $]" : "[bold.blue $]"
            }${options.watch ? ", waiting for changes..." : "."}`,
            params: [`Build files in ${closeMark()}`, errors + "/" + files],
        });
    };

    const build = createBuild(
        /**
         * Actions are functions that allow you to
         * communicate from the build events object.
         * This object allows isolating the cyclo and
         * watch processes from the build
         */
        {
            load: async (file) => {
                if (!file.assigned && cyclesTask[cyclesTaskCount]) {
                    const task = load(file);
                    cyclesTask[cyclesTaskCount].push(task);
                    return task;
                }
            },
            watch: (file) => {
                if (watcher) watcher.add(file.src);
            },
        },
        /**
         * Config
         */
        {
            href: options.site.href,
            assets: options.site.assets,
            /**
             * Lets associate file extensions for write transformations
             */
            types: options.types,
        }
    );

    build.options = options;
    build.rebuild = rebuild;

    const watcher = options.watch ? createWatch(build) : null;

    await pluginsParallel("mounted", plugins, build);
    await rebuild(listSrc);

    return build;
}
