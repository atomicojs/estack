import html from "parse5";
import { readFile, writeFile, copyFile, normalizePath } from "./utils";
import path from "path";
import marked from "marked";
import yaml from "js-yaml";

let cache = {};

let cacheHash = {};

let isNotStatic = /\.(js|jsx|ts|tsx|css)$/;

let ignore = ["#text", "#comment"];
/**
 *
 * @param {string} src
 * @param {string} dir
 * @param {string[]} htmlExports
 * @param {boolean} [disableCache]
 */
export default async function loadHtml(src, dir, htmlExports, disableCache) {
  let content = await readFile(src);

  if (!disableCache && cache[src] && cache[src].content == content) {
    return Cache.get(content);
  }

  let { ext, name, dir: dirOrg } = path.parse(src);

  let base = name + ".html";

  let meta = {};

  let htmlContent = content;

  if (ext == ".md") {
    htmlContent = marked(
      content.replace(/---([.\s\S]*)---/, (all, content, index) => {
        if (!index) {
          meta = yaml.safeLoad(content);
          return "";
        }
        return all;
      })
    );
  }

  /**@type {string[]} */
  let files = [];

  let findExpressions = formatExpressions(htmlExports);

  htmlContent = html.parse(htmlContent);

  let fragment = findExpressions.length
    ? analyze([].concat(htmlContent), addFile, findExpressions)
    : htmlContent;

  // staticFiles are copied to the destination
  await Promise.all(
    files
      .filter(file => !isNotStatic.test(file))
      .map(file => copyFile(file, path.join(dir, getFileStatic(file))))
  );

  function addFile(src) {
    src = normalizePath(path.join(dirOrg, src));
    !files.includes(src) && files.push(src);
    return getFileStatic(src);
  }
  /**
   * write the document to the destination directory
   * @param {Function} [template]
   * @param {Object} opts
   */
  function write(htmlInject, template, files) {
    let document = fragment;

    if (ext == ".md" && template) {
      document = [].concat(
        html.parse(
          template({
            ext,
            base,
            meta,
            files,
            content: fragment.join("")
          })
        )
      );
    }

    return writeFile(
      path.join(dir, base),
      formatExpressions(htmlInject).reduce(
        (document, { nodeName, attrs }) =>
          document.replace(
            /(\<\/head\>)/,
            `<${nodeName} ${Object.keys(attrs)
              .map(name => `${name}="${attrs[name].value}"`)
              .join(" ")}></${nodeName}>$1`
          ),
        document.map(fragment => html.serialize(fragment)).join("")
      )
    );
  }

  return (cache[src] = {
    content,
    write,
    files,
    base,
    meta,
    ext,
    src
  });
}

/**
 *
 * @param {Array} fragment
 * @param {Function} addFile
 * @param {Object} find
 */
function analyze(fragment, addFile, find) {
  let length = fragment.length;
  for (let i = 0; i < length; i++) {
    let node = fragment[i];

    if (ignore.includes(node.nodeName)) continue;

    if (node.attrs) {
      let nodeAttrs = node.attrs.reduce((attrs, { name, value }) => {
        attrs[name] = value;
        return attrs;
      }, {});
      for (let i = 0; i < find.length; i++) {
        let { nodeName, attrs } = find[i];
        if (nodeName == node.nodeName) {
          let size = 0;
          let sizeOk = 0;
          let src;
          for (let key in attrs) {
            let attr = attrs[key];
            size++;
            if (key in nodeAttrs) {
              if (attr.value == "*" || attr.value == nodeAttrs[key]) {
                if (
                  attr.src &&
                  !/^(http(s){0,1}:){0,1}\/\//.test(nodeAttrs[key])
                ) {
                  src = {
                    key,
                    value: nodeAttrs[key]
                  };
                }
                sizeOk++;
              }
            }
          }
          if (size == sizeOk && src) {
            node.attrs = node.attrs.map(({ name, value }) =>
              name == src.key
                ? {
                    name,
                    value: addFile(value)
                  }
                : { name, value }
            );
          }
        }
      }
    }

    !["script"].includes(node.nodeName) &&
      node.childNodes &&
      analyze(node.childNodes, addFile, find);
  }
  return fragment;
}

/**
 * create an id based on the path
 * @param {string} str
 */
function getHash(str) {
  return (cacheHash[str] =
    cacheHash[str] ||
    "file-" +
      str.split("").reduce((out, i) => (out + i.charCodeAt(0)) | 8, 4) +
      path.parse(str).ext);
}
// generates the name of the static file to insert into the HTML
function getFileStatic(src) {
  if (isNotStatic.test(src)) {
    let { name, ext } = path.parse(src);
    return name + (ext == ".css" ? ext : ".js");
  } else {
    return getHash(src);
  }
}

function formatExpressions(find) {
  return []
    .concat(find)
    .filter(value => value)
    .map(expression => {
      if (!expression) return {};
      let [nodeName, ...attrs] =
        expression.match(/([\w-]+)|(\[[^\]]+\])/g) || [];
      return {
        nodeName,
        attrs: attrs.reduce((attrs, attr) => {
          let [all, src, type, value = "*"] =
            attr.match(/\[(\:){0,1}([\w-]+)(?:=(.+)){0,1}\]/) || [];
          attrs[type] = {
            value: value,
            src: src != null
          };
          return attrs;
        }, {})
      };
    })
    .filter(({ nodeName }) => nodeName);
}