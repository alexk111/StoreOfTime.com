const http = require("http");
const path = require("path");

const csv = require("csv-parser");
const fse = require("fs-extra");

const pathSrc = "./src";
const pathCollected = pathSrc + "/data/_collected";
const pathCollectedBM = pathCollected + "/bm";

async function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve,duration));
}

async function loadCountriesFromCSV(filePath) {
  const countriesByCode = {};

  return new Promise((resolve, reject) => {
    fse
      .createReadStream(filePath)
      .pipe(csv({}))
      .on("data", (data) => {
        const {country_code, country_name, currency_code} = data;

        countriesByCode[country_code] = {
          country_name,
          currency_code
        }
      })
      .on("end", () => {
        resolve(countriesByCode);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function loadBMFromRemoteAPI(countryCodes) {
  const url = `http://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M.${countryCodes.join("+")}.FMB_XDC+FMB_EUR+FMB_USD?startPeriod=2013&endPeriod=${(new Date()).getUTCFullYear()}`;
  return new Promise((resolve, reject) => {
    http
      .get(url, {
        headers: {
          "User-Agent": "Data Agent"
        }
      }, (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", async () => {
          try {
            const gotData = JSON.parse(body);
            if (gotData && gotData.CompactData && gotData.CompactData.DataSet && gotData.CompactData.DataSet.Series) {
              for (const seriesItem of gotData.CompactData.DataSet.Series) {
                if (seriesItem.Obs) {
                  const countryCode = seriesItem["@REF_AREA"];
                  const pathOutFile = path.join(pathCollectedBM, `${countryCode}.json`);
                  const obsData = seriesItem.Obs;
                  const outData = [];
                  for (let i = 0; i < obsData.length; i++) {
                    const dataItem = obsData[i];
                    outData.push([dataItem["@TIME_PERIOD"], dataItem["@OBS_VALUE"]]);
                  }
                  await fse.writeFile(pathOutFile, JSON.stringify(outData,null,2));
                }
              }
            }
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

function chunkArrayInGroups(arr, size) {
  var myArray = [];
  for(var i = 0; i < arr.length; i += size) {
    myArray.push(arr.slice(i, i+size));
  }
  return myArray;
}

async function build() {
  console.info("Collecting Broad Money data...");

  const countries = await loadCountriesFromCSV(`${pathSrc}/data/countries.csv`);
  const countryCodeGroups = chunkArrayInGroups(Object.keys(countries), 70);

  for (let i=0; i<countryCodeGroups.length; i++) {
    console.info(`${i+1}/${countryCodeGroups.length}`);
    const countryCodeGroup = countryCodeGroups[i];
    await loadBMFromRemoteAPI(countryCodeGroup);
    await delay(500); // API limits = 10 requests in 5 second window from one user (IP)
  }
}

build();
