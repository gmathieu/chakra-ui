/* eslint-disable @typescript-eslint/no-var-requires */

const arg = require("arg");
const inquirer = require("inquirer");
const chalk = require("chalk");
const editJsonFile = require("edit-json-file");
const fs = require("fs");
const Listr = require("listr");
const ncp = require("ncp");
const path = require("path");
const { promisify } = require("util");
const execa = require("execa");

const access = promisify(fs.access);
const copy = promisify(ncp);

function parseArgsIntoOptions(rawArgs) {
  const args = arg(
    {
      "--no-hook": Boolean,
      "--file": Boolean,
    },
    {
      argv: rawArgs.slice(2),
    },
  );

  const inlineArgs = args._;

  return {
    noHook: args["--no-hook"] || false,
    asSingleFile: args["--file"] || false,
    component: inlineArgs[0],
  };
}

async function promptForMissingOptions(options) {
  const questions = [];
  if (!options.component) {
    questions.push({
      type: "input",
      name: "component",
      message: "What component would you like to create",
    });
  }

  const answers = await inquirer.prompt(questions);

  return {
    ...options,
    component: options.component || answers.component,
  };
}

async function copyTemplateFiles(options) {
  const templateDir = path.resolve(__dirname, "template");
  console.log(templateDir);

  options.templateDir = templateDir;
  options.targetDir = `packages/${options.component}`;

  try {
    await access(templateDir, fs.constants.R_OK);
  } catch {
    console.error(`%s Invalid template name`, chalk.red.bold("ERROR"));
    process.exit(1);
  }

  return copy(options.templateDir, options.targetDir, {
    clobber: false,
  });
}

function createFile(filePath, fileContent = "") {
  fs.writeFile(filePath, fileContent, error => {
    if (error) {
      console.log(`Failed to create ${filePath}`, chalk.red.bold("ERROR"));
      throw error;
    }
    console.log(`Create ${filePath}`, chalk.green.bold("DONE"));
  });
}

function createFiles(options) {
  if (options.asSingleFile) {
    createFile(`${options.component}.tsx`);
  } else {
    const files = [
      `${options.component}.tsx`,
      `${options.component}.stories.tsx`,
      `index.ts`,
      `README.md`,
    ];

    if (!options.noHook) {
      files.push(`${options.component}.hook.ts`);
    }

    const fileDir = `packages/${options.component}/src/`;
    files.forEach(file => {
      const filePath = fileDir + file;
      createFile(filePath);
    });
  }
}

function createDirectory(options) {
  const dir = options.component;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
  } catch (err) {
    console.error(err);
  }
}

function appendToSrc(options) {
  let content = `export * from "./${options.component}";`;
  if (!options.noHook) {
    content = content.concat(`\nexport * from  "./${options.component}.hook";`);
  }
  const path = getPath(options);
  fs.appendFile(`${path}/src/index.ts`, content, "utf8", function(err) {
    if (err) throw err;
    console.log("Data is appended to file successfully.");
  });
}

function getPath(options) {
  return `packages/${options.component}`;
}

function createPackageDir(options) {
  options = {
    ...options,
    component: getPath(options),
  };
  createDirectory(options);
}

// Edits the package JSON file
function editPackageJson(options) {
  const path = getPath(options);
  const name = options.component.toLowerCase();
  const file = editJsonFile(`${path}/package.json`);
  file.set("name", `@chakra-ui/${name}`);
  file.set("module", `dist/${name}.esm.js`);
  file.save();
}

function editRootPackageJson(options) {
  const name = options.component.toLowerCase();
  const file = editJsonFile(`package.json`);
  file.set(
    `scripts.${options.component.toLowerCase()}`,
    `yarn workspace @chakra-ui/${name}`,
  );
  file.save();
}

async function createPackage(options) {
  const tasks = new Listr([
    {
      title: "Create component package in packages/",
      task: () => createPackageDir(options),
    },
    { title: "Copy template files", task: () => copyTemplateFiles(options) },
    { title: "Add files to src", task: () => createFiles(options) },
    {
      title: "Edit package.json",
      task: () => editPackageJson(options),
    },
    { title: "Add export to src/index", task: () => appendToSrc(options) },
    {
      title: "Add shortcut to root package.json",
      task: () => editRootPackageJson(options),
    },
    {
      title: "Symlink all packages",
      task: async () => {
        const result = await execa("yarn", ["install"], {
          cwd: process.cwd(),
        });
        if (result.failed) {
          return Promise.reject(new Error("Failed to run yarn install"));
        }
      },
    },
  ]);

  await tasks.run();

  console.log("%s Project ready", chalk.green.bold("DONE"));
  return true;
}

async function run(args) {
  let options = parseArgsIntoOptions(args);
  options = await promptForMissingOptions(options);
  await createPackage(options);
}

run(process.argv);