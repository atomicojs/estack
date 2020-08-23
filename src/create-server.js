//@ts-ignore
import sirv from "sirv";

import path from "path";
import findPort from "@uppercod/find-port";
import polka from "polka";

import httpProxy from "http-proxy";
import {
    asyncFs,
    promiseErrorToNull,
    isHtml,
    normalizePath,
} from "./utils/utils";

let mime = {
    js: "application/javascript",
    json: "application/json; charset=utf-8",
    css: "text/css",
    text: "text/plain",
    html: "text/html; charset=utf-8",
};

let proxyServer = httpProxy.createProxyServer({
    changeOrigin: true,
});

let sendMessage = (res, channel, data) => {
    res.write(`event: ${channel}\nid: 0\ndata: ${data}\n`);
    res.write("\n\n");
};

let fileExists = async (file) =>
    (await promiseErrorToNull(asyncFs.stat(file))) && file;

/**
 * @param {Object} options
 * @param {string} options.root
 * @param {number} options.port
 * @param {boolean} options.reload
 * @param {string} options.proxy
 * @returns {Promise<server>}
 */
export async function createServer({ root, port, reload, proxy }) {
    const nextAssets = sirv(root, {
        dev: true,
    });

    const nextAssetsRoot = sirv(".", {
        dev: true,
    });

    port = await findPort(port, port + 100);

    const nextProxy =
        proxy &&
        ((req, res) =>
            proxyServer.web(req, res, {
                target: proxy,
            }));

    const fallback = normalizePath(path.join(root, "index.html"));
    const notFound = normalizePath(path.join(root, "404.html"));

    const responses = [];
    /**@type {server["sources"]}*/
    const sources = {};

    const addLiveReload = (code) =>
        (code += `
  <script>{
    let source = new EventSource('http://localhost:${port}/livereload');
    source.onmessage = e =>  setTimeout(()=>location.reload(),250);
  }</script>
`);

    polka()
        .use(async (req, res, next) => {
            if (req.path == "/livereload" && reload) {
                next();
                return;
            }

            let file = req.path;

            if (file == "/") {
                file = "index.html";
            } else if (/\/$/.test(file)) {
                file += "index.html";
            } else if (!/\.[\w]+$/.test(file)) {
                file += ".html";
            }

            file = normalizePath(path.join(root, file));

            const virtualSource =
                sources[file] ||
                (isHtml(file) ? sources[fallback] : sources[notFound]);

            const [resolveHtml, resolveStatic, resolveFallback] = virtualSource
                ? []
                : await Promise.all([
                      // check if the file exists as html
                      isHtml(file) && fileExists(file),
                      // check if the file exists as static
                      fileExists(file),
                      // it is verified in each request of the html type,
                      // to ensure the existence in a dynamic environment
                      isHtml(file) && !proxy && fileExists(fallback), //
                  ]);

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Cache-Control", "no-cache");

            // mirror files to server without writing
            if (virtualSource) {
                if (virtualSource.stream) {
                    req.path = virtualSource.stream;
                    nextAssetsRoot(req, res, next); //
                } else {
                    let { code, type } = virtualSource;

                    res.setHeader("Content-Type", mime[type]);

                    res.end(type == "html" ? addLiveReload(code) : code);
                }
            } else if (resolveHtml || resolveFallback) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                try {
                    let code = await asyncFs.readFile(
                        resolveHtml || resolveFallback,
                        "utf8"
                    );
                    res.end(reload ? addLiveReload(code) : code);
                } catch (e) {
                    res.end(e);
                }
            } else if (resolveStatic) {
                nextAssets(req, res, next);
            } else if (nextProxy) {
                nextProxy(req, res);
            } else {
                res.statusCode = 404;
                res.end("");
            }
        })
        .use((req, res) => {
            // livereload
            res.writeHead(200, {
                Connection: "keep-alive",
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            });
            // Send an initial ack event to stop any network request pending
            sendMessage(res, "connected", "awaiting change");
            // Send a ping event every minute to prevent console errors
            setInterval(sendMessage, 60000, res, "ping", "still waiting");
            // Watch the target directory for changes and trigger reload
            responses.push(res);
        })
        .listen(port);

    return {
        port,
        sources,
        reload() {
            responses.forEach((res) =>
                sendMessage(res, "message", "reloading page")
            );
        },
    };
}

/**
 * @typedef {Object} source
 * @property {string} [type] - type of file
 * @property {string} [code] - file code if this is string
 * @property {string} [stream] - origin of the file to generate stream of this
 */

/**
 * @typedef {Object} server
 * @property {number} port
 * @property {{[index:string]:source}} sources
 * @property {()=>void} reload
 */
