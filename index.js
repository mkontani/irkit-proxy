"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const axios = require("axios");
require("dotenv").config();
const logger = require("log4js").getLogger();
logger.level = process.env.LOG_LEVEL || "warn";

const Serve = async (conf) => {
  let server;
  if (process.env.USETLS) {
    server = https.createServer(
      {
        key: fs.readFileSync(process.env.KEY_PATH),
        cert: fs.readFileSync(process.env.CERT_PATH),
      },
      async (req, res) => {
        req.protocol = "https";
        await apply(req, res, conf);
      }
    );
  } else {
    server = http.createServer(async (req, res) => {
      req.protocol = "http";
      await apply(req, res, conf);
    });
  }
  const port = process.env.PORT || 8000;
  server.listen(port, () => {
    const schema = process.env.USETLS ? "HTTPS" : "HTTP";
    logger.info(`${schema} Server is listening on PORT ${port}`);
  });

  server.on("error", (e) => {
    logger.error(e);
    process.exit(1);
  });
};

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

const apply = async (req, res, confmap) => {
  let data = "";
  req.on("data", (chunk) => {
    data += chunk;
  });
  req.on("end", async () => {
    const url = new URL(req.url, `${req.protocol}://${req.headers.host}`);
    // healthcheck ep
    if (url.pathname === "/status" && req.method === "GET") {
      res.statusCode = 200;
      res.end("ok");
      return;
    }
    // api endpoint
    else if (url.pathname === "/v1/api/irkit" && req.method === "POST") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        logger.warn("request params invalid", e);
        res.statusCode = 403;
        res.end("request params invalid");
        return;
      }
      if (data?.apikey !== process.env.APIKEY) {
        logger.warn("unauthorized");
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
      const repeat = data?.repeat || 1;

      const usemap = confmap.find((map) =>
        map.words.every((word) => String(data?.phrase).includes(word))
      );
      if (!usemap?.payload) {
        logger.warn("correspond mapping is not defined", data);
        res.statusCode = 400;
        res.end("correspond mapping is not defined");
        return;
      }

      let failtimes = 0;
      for (let i = 0; i < repeat; i++) {
        try {
          logger.info(`request ${i + 1} of ${repeat}`);
          const resp = await axios({
            method: "post",
            url: "https://api.getirkit.com/1/messages",
            data: usemap.payload,
            headers: {
              "content-type": "application/x-www-form-urlencoded",
            },
          });
          if (resp.status === 200) {
            logger.info(`Accepted ${i + 1} times.`);
          } else {
            logger.warn("request to irkit is failed", resp);
            failtimes++;
          }
        } catch {
          (e) => {
            logger.error(e);
            res.statusCode = 500;
            res.end("request to irkit came to exception");
          };
        }
        await sleep(1000);
      }
      if (failtimes === repeat) {
        logger.warn(`all request failed`);
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(`all request failed.`);
        return;
      } else if (failtimes > 0) {
        logger.warn(`request partially successed. FailTimes: ${failtimes}`);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`request partially successed. FailTimes: ${failtimes}`);
        return;
      } else {
        logger.info("all request successed.");
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("accepted");
        return;
      }
    } else {
      logger.warn(
        `reqeust path or method is invalid: Path: ${url.pathname}, method: ${req.method}`
      );
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
  });
};

const confpath = process.env.CONF_PATH || "./mappings.json";
const conf = require(confpath);
Serve(conf);
