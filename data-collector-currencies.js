const https = require("https");
const path = require("path");

const fse = require("fs-extra");

const pathSrc = "./src";
const pathCollected = pathSrc + "/data/_collected";

async function loadCurrenciesFromRemoteAPI() {
  const url = "https://openexchangerates.org/api/currencies.json";
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", async () => {
          try {
            const gotData = JSON.parse(body);
            const pathOutFile = path.join(pathCollected, "currencies.json");
            await fse.writeFile(pathOutFile, JSON.stringify(gotData,null,2));
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

async function build() {
  console.info("Collecting Currencies data...");

  await loadCurrenciesFromRemoteAPI();
}

build();
