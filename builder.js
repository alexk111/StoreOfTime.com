const { promisify } = require("util");

const crypto = require("crypto");
const csv = require("csv-parser");
const ejs = require("ejs");
const fse = require("fs-extra");
const promGlob = promisify(require("glob"));
const https = require("https");
const path = require("path");

const pathSrc = "./src";
const pathBuild = "./build";
const pathCache = "./cache";

const isDevMode = process.env.NODE_ENV === "development";

const something = require(`${pathSrc}/data/something.json`);

const thingPrices = {}; // thing price history in USD
const bitcoinPrices = {}; // Bitcoin price history in USD/XAU/XAG
const storePrices = {}; // BTC/XAU/XAG price history in USD

function strPriceToNum(strPrice) {
  return (strPrice * 1).toFixed(2) * 1;
}

function strDateToArr(strDate) {
  // YYYY-MM-DD
  const arrDate = strDate.split("-").map((item) => `${item * 1}`);
  if (arrDate.length !== 3) {
    throw new Error(
      `Invalid Date "${strDate}". Dates should be in "YYYY-MM-DD" format.`
    );
  }
  return arrDate;
}

async function loadThingPricesFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    fse
      .createReadStream(filePath)
      .pipe(csv({}))
      .on("data", (data) => {
        const strDate = data[something.csvColumnNames.date];
        const arrDate = strDateToArr(strDate);

        if (arrDate[0] * 1 >= something.year.from) {
          const strCategory = data[something.csvColumnNames.category];
          const strPrice = data[something.csvColumnNames.usdPrice];
          if (thingPrices[strCategory] === undefined) {
            thingPrices[strCategory] = {};
          }
          if (thingPrices[strCategory][arrDate[0]] === undefined) {
            thingPrices[strCategory][arrDate[0]] = {};
          }
          if (thingPrices[strCategory][arrDate[0]][arrDate[1]] === undefined) {
            thingPrices[strCategory][arrDate[0]][arrDate[1]] = {};
          }
          thingPrices[strCategory][arrDate[0]][arrDate[1]][
            arrDate[2]
          ] = strPriceToNum(strPrice);
        }
      })
      .on("end", () => {
        resolve();
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}
async function loadThingPrices() {
  // Get price files
  const csvPaths = await promGlob("**/*.csv", {
    cwd: `${pathSrc}/data`,
  });

  // Load prices
  for (const csvPath of csvPaths) {
    await loadThingPricesFromCSV(`${pathSrc}/data/${csvPath}`);
  }
}

function prepareBitcoinPrices(vsCurrency, dataFromRemoteAPI) {
  const prices = JSON.parse(dataFromRemoteAPI).prices;

  bitcoinPrices[vsCurrency] = {};
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const d = new Date(price[0]);

    bitcoinPrices[vsCurrency][
      `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    ] = price[1];
  }
}

async function loadBitcoinPricesFromRemoteAPI(vsCurrency) {
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=${vsCurrency}&from=1360000000&to=3000000000`;
  const urlHash = crypto.createHash("md5").update(url).digest("hex");
  const pathCacheFile = path.join(pathCache, urlHash);

  if (isDevMode) {
    if (fse.existsSync(pathCacheFile)) {
      const cachedData = await fse.readFile(pathCacheFile);
      prepareBitcoinPrices(vsCurrency, cachedData);
      return;
    }
  }

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", async () => {
          try {
            if (isDevMode) {
              await fse.writeFile(pathCacheFile, body);
            }

            prepareBitcoinPrices(vsCurrency, body);
            resolve();
          } catch (error) {
            reject(error.message);
          }
        });
      })
      .on("error", (error) => {
        reject(error.message);
      });
  });
}

async function loadBitcoinPrices() {
  await loadBitcoinPricesFromRemoteAPI("usd");
  for (const storeId in something.stores) {
    await loadBitcoinPricesFromRemoteAPI(storeId);
    await loadBitcoinPricesFromRemoteAPI(storeId);
  }
}

function calculateStorePrices() {
  // Bitcoin
  storePrices["btc"] = {};
  for (const date in bitcoinPrices["usd"]) {
    const arrDate = date.split("-");

    if (storePrices["btc"][arrDate[0]] === undefined) {
      storePrices["btc"][arrDate[0]] = {};
    }
    if (storePrices["btc"][arrDate[0]][arrDate[1]] === undefined) {
      storePrices["btc"][arrDate[0]][arrDate[1]] = {};
    }
    storePrices["btc"][arrDate[0]][arrDate[1]][arrDate[2]] = strPriceToNum(
      bitcoinPrices["usd"][date]
    );
  }

  // The rest
  for (const curr in bitcoinPrices) {
    if (curr === "btc" || curr === "usd") {
      continue;
    }

    storePrices[curr] = {};
    for (const date in bitcoinPrices[curr]) {
      const arrDate = date.split("-");

      if (storePrices[curr][arrDate[0]] === undefined) {
        storePrices[curr][arrDate[0]] = {};
      }
      if (storePrices[curr][arrDate[0]][arrDate[1]] === undefined) {
        storePrices[curr][arrDate[0]][arrDate[1]] = {};
      }
      storePrices[curr][arrDate[0]][arrDate[1]][arrDate[2]] = strPriceToNum(
        bitcoinPrices["usd"][date] / bitcoinPrices[curr][date]
      );
    }
  }
}

async function build() {
  console.info("Building..." + (isDevMode ? " (dev mode)" : ""));

  // Prepare cache dir
  if (isDevMode) {
    await fse.mkdirs(pathCache);
  }

  // Load prices
  console.info("Loading local data...");
  await loadThingPrices();
  console.info("Fetching remote data...");
  await loadBitcoinPrices();

  // Calculate prices
  calculateStorePrices();

  // Clear build dir
  await fse.emptyDir(pathBuild);

  // Copy static assets
  fse.copy(`${pathSrc}/assets`, `${pathBuild}/assets`);
  console.info("Copied assets");

  // Get templates
  const tplPaths = await promGlob("**/*.ejs", { cwd: `${pathSrc}/templates` });

  // Generate pages from templates
  tplPaths.forEach(async (tplPath) => {
    const tplPathData = path.parse(tplPath);
    const destPath = path.join(pathBuild, tplPathData.dir);

    await fse.mkdirs(destPath);
    const pageHtml = await ejs.renderFile(
      `${pathSrc}/templates/${tplPath}`,
      {
        something,
        thingPrices,
        storePrices,
      },
      { async: true }
    );

    const htmlFilePath = `${pathBuild}/${tplPathData.name}.html`;
    fse.writeFile(htmlFilePath, pageHtml).then(() => {
      console.info(`Built ${htmlFilePath}`);
    });
  });
}

build();
