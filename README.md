# bundle-cli

Designed to simplify the frontend web development experience with:

1. Search for expressions for the generation of inputs for the bundle eg `example/src/*.{html,md}`.

2. The analysis on the html files allows the extraction of the files that use the expression by link [href] or [src] attribute.

3. Optimization of the output through the flag `--minify`.

4. Livereload optimized only for updates of the files associated with the bundle

5. output configuration based on [browserslist](https://github.com/browserslist/browserslist) for css and js, using the flag --browsers

## flags

### --watch

allows to observe the changes associated with the given expression, bundle-cli is layers to regenerate the build, at the time of creating files that comply with the given expression.

### --server

allows you to create a server that synchronizes with the observer if accompanied by the `--watch` flag

### --port

allows you to define a port to use or initialize the search if it is already busy.

### --sourcemap

allows to enable or disable the generation of sourcemap for js files

### --external

if `true` will associate the dependencies as external to the bundle, you can use a list to define the externals manually, eg`atomic, preact, react`

### --template

allows you to define a top level template for markdown or html files

### --minify

It allows you to modify the code generated by the bundle, html, css and js.

### --jsx

allows you to define the type of pragma to work globally, if you want to use react just define `--jsx react`

### --template

allow you to associate an html template to contain html or md files. eg:

```html
---
color: red
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>title - {{page.title}}</title>
  </head>
  <body>
    <h2>title - {{page.title}}</h2>
    template : {{>content}}
    <style>
      body{ background: {{site.color}} }
    </style>
  </body>
</html>
```

the use of `---` allows to open the yaml metadata to be associated with the template, which is grouped as follows, eg:

```js
{
  // template metadata
  site: {
  }
  // metadata of the current page
  page: {
  }
}
```

You can define the `folder` property to associate a destination for your html or md file. eg : `gallery/1` the template is processed by Mustache

## bundle-cli is built thanks to:

bundle-cli is built with Rollup, Chokidar, fast-glob, mustache, postcss and other incredible packages
