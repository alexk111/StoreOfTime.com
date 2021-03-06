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
const pathCollectedStocks = path.join(pathCollected, "stocks");
const pathBuild = path.join(".", "build");

const isDevMode = process.env.NODE_ENV === "development";

const something = require(`./src/data/something.json`);

const cpi = {}; // CPI (Consumer Price Index) (by country code)
const usdPrices = {}; // USD price history in different currencies (by currency code)
const countries = {}; // countries data (by country code)
const redenominations = {}; // redenominations data (by country code)
const stocksInfo = {}; // stocks info (by symbol name)
const stocksInfoByFilename = {}; // stocks info (by filename)
const stocks = {}; // stocks history (by symbol name)

const countriesWithAllData = {}; // countries that have all the necessary data (by country code)
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

async function loadStocksInfoFromCSV() {
  return new Promise((resolve, reject) => {
    fse
      .createReadStream(path.join(pathData, "stocks.csv"))
      .pipe(csv({}))
      .on("data", (data) => {
        const {symbol,name,filename} = data;
        stocksInfo[symbol] = { name, filename };
        stocksInfoByFilename[filename] = {name, symbol};
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

async function loadStockFromJSON(filePath) {
  const fileData = await fse.readFile(filePath);
  const parsedData = JSON.parse(fileData);
  const strStockFilename = path.basename(filePath, '.json');
  const stockInfo = stocksInfoByFilename[strStockFilename];
  stocks[stockInfo.symbol] = {};
  for (const item of parsedData) {
    stocks[stockInfo.symbol][item[0]] = item[1];
  }
}

async function loadStocks() {
  // Get stock files
  const jsonPaths = await promGlob("**/*.json", {
    cwd: pathCollectedStocks,
  });

  // Load stocks
  for (const jsonPath of jsonPaths) {
    await loadStockFromJSON(path.join(pathCollectedStocks, jsonPath));
  }
}

function applyRedenomination(countryCode, baseAmount, nowTimestamp) {
  const res = {
    amount: baseAmount,
    currencyCode: countries[countryCode][1]
  }
  if (redenominations[countryCode]) {
    for (const item of redenominations[countryCode]) {
      if (nowTimestamp >= item.timestamp) {
        res.currencyCode = item.new_currency_code;
        res.amount = res.amount * (item.to_amount / item.from_amount);
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
      BTC: [],
      local: [],
      USD: []
    };
    for (const store of Object.keys(something.stores)) {
      pricesByStores[store] = [];
    }
    for (const stock of Object.keys(stocks)) {
      pricesByStores[stock] = [];
    }

    const cpiItems = cpi[countryCode];
    if (!cpiItems) {
      continue;
    }

    countriesWithAllData[countryCode] = countries[countryCode];

    let curAmountCurrencyNow;
    let setEstimatePrice;
    let curCPIStrYYYYMMDD;
    let curThingPriceInLocalBase;
    let curThingPriceInLocalNow;
    let currCodeNow;

    const addToPricesByStores = (strYYYYMMDD, thingPriceInLocalBase, thingPriceInLocalNow, currencyCodeNow, isEstimate) => {
      // a. local price
      pricesByStores["local"].push([strYYYYMMDD,thingPriceInLocalBase, isEstimate ? 0 : 1]);

      // b. calc usd price
      const thingPriceInUSD = thingPriceInLocalNow / usdPrices[currencyCodeNow][strYYYYMMDD];
      pricesByStores["USD"].push([strYYYYMMDD, thingPriceInUSD, isEstimate ? 0 : 1]);

      // c. calc btc & other prices
      for (const store of ["BTC"].concat(Object.keys(something.stores))) {
        let thingPriceInStore;
        if (usdPrices[store]) {
          thingPriceInStore = thingPriceInUSD * usdPrices[store][strYYYYMMDD];
        } else {
          thingPriceInStore = thingPriceInUSD / stocks[store][strYYYYMMDD];
        }
        pricesByStores[store].push([strYYYYMMDD, thingPriceInStore, isEstimate ? 0 : 1]);
      }
    }

    // 1. calc with cpi data
    for (const cpiItem of cpiItems) {
      const {strYYYYMM, cpiVal} = cpiItem;
      curCPIStrYYYYMMDD = strYYYYMM + "-01";
      curThingPriceInLocalBase = cpiVal * 1;

      setEstimatePrice = (!curThingPriceInLocalBase);

      const timestamp = strYYYYMMDDToTimestamp(curCPIStrYYYYMMDD);
      if (!setEstimatePrice) {
        curAmountCurrencyNow = applyRedenomination(countryCode, curThingPriceInLocalBase, timestamp);
      }
      curThingPriceInLocalNow = curAmountCurrencyNow.amount;
      currCodeNow = curAmountCurrencyNow.currencyCode;

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

  // Load prices
  console.info("Loading data...");
  await loadCountriesFromCSV();
  await loadRedenominationsFromCSV();
  await loadStocksInfoFromCSV();
  await loadUSDPrices();
  await loadCPI();
  await loadStocks();

  // Calculate prices
  calculateThingPrices();

  // Clear build dir
  await fse.emptyDir(pathBuild);

  // Copy static files
  fse.copy(path.join(pathSrc, "root"), path.join(pathBuild));
  fse.copy(path.join(pathSrc, "assets"), path.join(pathBuild, "assets"));
  console.info("Copied assets");

  // Make data files
  const destDataPath = path.join(pathBuild, "data");
  await fse.mkdirs(destDataPath);
  for (const countryCode of Object.keys(thingPrices)) {
    const dataFilePath = path.join(destDataPath, countryCode + ".json");
    fse.writeFile(dataFilePath, JSON.stringify(thingPrices[countryCode]));
    console.info(`Built data file ${dataFilePath}`);
  }

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
        countries: countriesWithAllData,
        thingPrices,
      },
      { async: true }
    );

    const htmlFilePath = path.join(pathBuild, tplPathData.name + ".html");
    fse.writeFile(htmlFilePath, pageHtml).then(() => {
      console.info(`Built page file ${htmlFilePath}`);
    });
  });
}

build();
