const { promisify } = require("util");

const crypto = require("crypto");
const csv = require("csv-parser");
const ejs = require("ejs");
const fse = require("fs-extra");
const promGlob = promisify(require("glob"));
const https = require("https");
const path = require("path");

const pathSrc = path.join(".", "src");
const pathData = path.join(pathSrc, "data");
const pathCollected = path.join(pathData, "_collected");
const pathCollectedCPI = path.join(pathCollected, "cpi");
const pathCollectedUSDRates = path.join(pathCollected, "usd-rates");
const pathBuild = path.join(".", "build");

const isDevMode = process.env.NODE_ENV === "development";

const something = require(`./src/data/something.json`);

const cpi = {}; // CPI (Consumer Price Index) (by country code)
const usdPrices = {}; // USD price history in different currencies (by currency code)
const countries = {}; // countries data (by country code)
const redenominations = {}; // redenominations data (by country code)

const thingPrices = {}; // thing price history in Local/USD/BTC/XAU/XAG (by country code)

let latestYYYYMMDD;

function strPriceToNum(strPrice) {
  return (strPrice * 1).toFixed(2) * 1;
}

function strYYYYMMDDToArr(strDate) {
  // YYYY-MM-DD
  const arrDate = strDate.split("-").map((item) => `${item * 1}`);
  if (arrDate.length !== 3) {
    throw new Error(
      `Invalid Date "${strDate}". Should be in "YYYY-MM-DD" format.`
    );
  }
  return arrDate;
}

function strYYYYMMDDToTimestamp(strDate) {
  const arrDate = strYYYYMMDDToArr(strDate);
  return Date.UTC(arrDate[0]*1,(arrDate[1]*1-1),arrDate[2]*1);
}

function strYYYYMMToArr(strDate) {
  // YYYY-MM
  const arrDate = strDate.split("-").map((item) => `${item * 1}`);
  if (arrDate.length !== 2) {
    throw new Error(
      `Invalid Date "${strDate}". Should be in "YYYY-MM" format.`
    );
  }
  return arrDate;
}

function dateToYYYYMMDD(d) {
  let month = '' + (d.getUTCMonth() + 1);
  let date = '' + d.getUTCDate();
  const year = d.getUTCFullYear();

  if (month.length < 2) {
    month = '0' + month;
  }

  if (date.length < 2) {
    date = '0' + date;
  }

  return [year, month, date].join('-');
}

async function loadCountriesFromCSV() {
  return new Promise((resolve, reject) => {
    fse
      .createReadStream(path.join(pathData, "countries.csv"))
      .pipe(csv({}))
      .on("data", (data) => {
        const {country_code,country_name,currency_code} = data;
        if (something.countries.excluded.indexOf(country_code)<0) {
          countries[country_code] = [country_name, currency_code, country_code];
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

async function loadRedenominationsFromCSV() {
  return new Promise((resolve, reject) => {
    fse
      .createReadStream(path.join(pathData, "redenominations.csv"))
      .pipe(csv({}))
      .on("data", (data) => {
        const {date,country_code,new_currency_code,from_amount,to_amount} = data;
        if (something.countries.excluded.indexOf(country_code)<0) {
          if (!redenominations[country_code]) {
            redenominations[country_code] = [];
          }
          redenominations[country_code].push({timestamp: strYYYYMMDDToTimestamp(date), new_currency_code,from_amount,to_amount});
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

async function loadUSDPricesFromJSON(filePath) {
  const fileData = await fse.readFile(filePath);
  const parsedData = JSON.parse(fileData);
  const strDate = path.basename(filePath, '.json');
  let strYYYYMMDD;
  let rates;
  if (strDate === "latest") {
    latestYYYYMMDD = parsedData.date;
    strYYYYMMDD = parsedData.date;
    rates = parsedData.rates;
  } else {
    strYYYYMMDD = strDate+"-01";
    rates = parsedData;
  }
  const arrYYYYMMDD = strYYYYMMDDToArr(strYYYYMMDD);
  if (arrYYYYMMDD[0] * 1 >= something.year.from) {
    for (const currCode of Object.keys(rates)) {
      const price = rates[currCode];
      if (usdPrices[currCode] === undefined) {
        usdPrices[currCode] = {};
      }
      usdPrices[currCode][strYYYYMMDD] = price;
    }
  }
}

async function loadUSDPrices() {
  // Get USD price files
  const jsonPaths = await promGlob("**/*.json", {
    cwd: pathCollectedUSDRates,
  });

  // Load prices
  for (const jsonPath of jsonPaths) {
    await loadUSDPricesFromJSON(path.join(pathCollectedUSDRates, jsonPath));
  }
}

async function loadCPIFromJSON(filePath) {
  const countryCode = path.basename(filePath, '.json');
  if (something.countries.excluded.indexOf(countryCode)>-1) {
    return;
  }
  const fileData = await fse.readFile(filePath);
  const parsedData = JSON.parse(fileData);
  let foundFirstNonNull = false;
  for (const dataItem of parsedData) {
    const strYYYYMM = dataItem[0];
    if (strYYYYMM === "2013-01" || strYYYYMM === "2013-02" || strYYYYMM === "2013-03") {
      continue;
    }

    let cpiVal;
    if (dataItem[1] === null) {
      if (!foundFirstNonNull) {
        continue; // skip nulls at the beginning
      }
      cpiVal = null;
    } else {
      foundFirstNonNull = true;
      cpiVal = dataItem[1]*1;
    }

    if (cpi[countryCode] === undefined) {
      cpi[countryCode] = [];
    }
    cpi[countryCode].push({
      strYYYYMM,
      cpiVal
    })
  }

  cpi[countryCode].sort((v1,v2) => v1.strYYYYMM > v2.strYYYYMM ? 1 : -1);
}

async function loadCPI() {
  // Get cpi files
  const jsonPaths = await promGlob("**/*.json", {
    cwd: pathCollectedCPI,
  });

  // Load cpi
  for (const jsonPath of jsonPaths) {
    await loadCPIFromJSON(path.join(pathCollectedCPI, jsonPath));
  }
}

function applyRedenomination(countryCode, nowAmount, nowTimestamp) {
  const res = {
    base: {
      amount: nowAmount,
      currencyCode: countries[countryCode][1]
    },
    now: {
      amount: nowAmount,
      currencyCode: countries[countryCode][1]
    }
  }
  if (redenominations[countryCode]) {
    for (const item of redenominations[countryCode]) {
      if (item.timestamp >= nowTimestamp) {
        res.now.currencyCode = item.new_currency_code;
        res.base.amount = res.base.amount * (item.from_amount / item.to_amount);
      } else {
        break;
      }
    }
  }
  return res;
}

function calculateThingPrices() {
  for (const countryCode of Object.keys(countries)) {
    // init
    const pricesByStores = {
      BTC: {},
      local: {},
      USD: {}
    };
    for (const store of Object.keys(something.stores)) {
      pricesByStores[store] = {};
    }

    const cpiItems = cpi[countryCode];
    if (!cpiItems) {
      continue;
    }

    let curPriceObj;
    let setEstimatePrice;
    let curCPIStrYYYYMMDD;
    let curThingPriceInLocalBase;
    let curThingPriceInLocalNow;
    let currCodeNow;

    const addToPricesByStores = (strYYYYMMDD, thingPriceInLocalBase, thingPriceInLocalNow, currencyCodeNow, isEstimate) => {
      // a. local price
      pricesByStores["local"][strYYYYMMDD] = [thingPriceInLocalBase, isEstimate ? 0 : 1];

      // b. calc usd price
      const thingPriceInUSD = thingPriceInLocalNow / usdPrices[currencyCodeNow][strYYYYMMDD];
      pricesByStores["USD"][strYYYYMMDD] = [thingPriceInUSD, isEstimate ? 0 : 1];

      // c. calc btc & other prices
      for (const store of Object.keys(pricesByStores)) {
        if (store !== "local" && store !== "USD") {
          const thingPriceInStore = thingPriceInUSD * usdPrices[store][strYYYYMMDD];
          pricesByStores[store][strYYYYMMDD] = [thingPriceInStore, isEstimate ? 0 : 1];
        }
      }
    }

    // 1. calc with cpi data
    for (const cpiItem of cpiItems) {
      const {strYYYYMM, cpiVal} = cpiItem;
      curCPIStrYYYYMMDD = strYYYYMM + "-01";
      curThingPriceInLocalNow = cpiVal * 1;

      setEstimatePrice = (!curThingPriceInLocalNow);

      const timestamp = strYYYYMMDDToTimestamp(curCPIStrYYYYMMDD);
      if (!setEstimatePrice) {
        curPriceObj = applyRedenomination(countryCode, curThingPriceInLocalNow, timestamp);
      }
      curThingPriceInLocalBase = curPriceObj.base.amount;
      currCodeNow = curPriceObj.now.currencyCode;

      addToPricesByStores(curCPIStrYYYYMMDD, curThingPriceInLocalBase, curThingPriceInLocalNow, currCodeNow, setEstimatePrice);
    }

    // 2. calc estimates for dates after the last cpi and till the latest exchange rate
    setEstimatePrice = true;
    const dPointer = new Date(strYYYYMMDDToTimestamp(curCPIStrYYYYMMDD));
    const dEndPointer = new Date(strYYYYMMDDToTimestamp(latestYYYYMMDD));

    do {
      dPointer.setUTCDate(dPointer.getUTCDate()+1);
      const strYYYYMMDDPointer = dateToYYYYMMDD(dPointer);
      if (usdPrices[currCodeNow][strYYYYMMDDPointer]) {
        addToPricesByStores(strYYYYMMDDPointer, curThingPriceInLocalBase, curThingPriceInLocalNow, currCodeNow, setEstimatePrice);
      }
    } while (dPointer.getTime()<=dEndPointer.getTime());

    // 3. done
    thingPrices[countryCode] = pricesByStores;
  }
}

async function build() {
  console.info("Building..." + (isDevMode ? " (dev mode)" : ""));

  // Prepare cache dir
  if (isDevMode) {
    await fse.mkdirs(pathCache);
  }

  // Load prices
  console.info("Loading data...");
  await loadCountriesFromCSV();
  await loadRedenominationsFromCSV();
  await loadUSDPrices();
  await loadCPI();

  // Calculate prices
  calculateThingPrices();

  // Clear build dir
  await fse.emptyDir(pathBuild);

  // Copy static assets
  fse.copy(path.join(pathSrc, "assets"), path.join(pathBuild, "assets"));
  console.info("Copied assets");

  // Get templates
  const tplPaths = await promGlob("**/*.ejs", { cwd: `${pathSrc}/templates` });

  // Generate pages from templates
  tplPaths.forEach(async (tplPath) => {
    const tplPathData = path.parse(tplPath);
    const destPath = path.join(pathBuild, tplPathData.dir);

    await fse.mkdirs(destPath);
    const pageHtml = await ejs.renderFile(
      path.join(pathSrc, "templates", tplPath),
      {
        something,
        countries,
        thingPrices,
      },
      { async: true }
    );

    const htmlFilePath = path.join(pathBuild, tplPathData.name + ".html");
    fse.writeFile(htmlFilePath, pageHtml).then(() => {
      console.info(`Built ${htmlFilePath}`);
    });
  });
}

build();
