import axios from "axios";
import { URL } from "url";
import * as uuid from "uuid";
import dotenv from "dotenv";
dotenv.config();

const defaultAcip = "10.252.155.2"; // 10.252.13.10

const defaultRandomUmac = Array.from({ length: 6 }, (_, i) =>
  ("0" + uuid.v4().split("-")[0].slice(-2)).slice(-2)
)
  .reverse()
  .join("");

const timeRepeat = 5 * 60 * 1000;
const maxLoginAttempt = parseInt(process.env.MAX_LOGIN_ATTEMPT || "-1");

const username = process.env.KMITL_USERNAME || "";
const password = process.env.KMITL_PASSWORD || "";
const ipAddress = process.env.IP_ADDRESS || "";

const serverUrl = "https://portal.kmitl.ac.th:19008/portalauth/login";
const serverUrlHeartbeat = "https://nani.csc.kmitl.ac.th/network-api/data/";
const generate204Url = "http://www.gstatic.com/generate_204";

function log(message: string): void {
  const timestamp = new Date().toLocaleString();
  console.log(`${timestamp}: ${message}`);
}

async function doPost(url: string, data: string): Promise<any> {
  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    return { statusCode: response.status, body: response.data };
  } catch (error) {
    throw error;
  }
}

interface LoginUrlResponse {
  url: string;
  data: {
    acip: string;
    redirectUrl: string;
    uaddress: string;
    umac: string;
    ssid: string;
  };
}

async function getLoginUrl(): Promise<LoginUrlResponse | null> {
  try {
    const response = await axios.get(generate204Url);
    const html = response.data;
    const urlMatch = html.match(/URL=([^"']+)/);
    if (urlMatch && urlMatch[1]) {
      const url = decodeURI(urlMatch[1]);
      const query = new URL(url).searchParams;

      const queryParameters: { [key: string]: string } = {};
      query.forEach((value, key) => {
        queryParameters[key] = value;
      });

      return {
        url,
        data: {
          acip: queryParameters["ac-ip"],
          redirectUrl: queryParameters["redirect-url"],
          uaddress: queryParameters["uaddress"],
          umac: queryParameters["umac"],
          ssid: queryParameters["ssid"],
        },
      };
    } else {
      return null;
    }
  } catch (error) {
    log(`Error during URL fetching: ${error}`);
    return null;
  }
}

interface LoginResult {
  isEscape: boolean;
  data: any;
  enableAutoVerify: boolean;
  token: string;
  success: boolean;
  tempPassEnable: boolean;
  psessionid: string;
  netSwitchStatus: string;
}

async function login(): Promise<LoginResult | null> {
  const loginUrlData = await getLoginUrl();
  if (loginUrlData) {
    log(`Login URL: ${loginUrlData.url}`);
  } else {
    log("Login URL not found, attempting to login without parameters.");
  }

  const postData = new URLSearchParams({
    userPass: password,
    authType: "1",
    ssid: loginUrlData?.data.ssid ? btoa(loginUrlData.data.ssid) : "",
    uaddress: loginUrlData?.data.uaddress ?? ipAddress,
    umac: loginUrlData?.data.umac ?? defaultRandomUmac,
    acip: loginUrlData?.data.acip ?? defaultAcip,
    agreed: "1",
    userName: username,
  }).toString();

  try {
    const response = await doPost(serverUrl, postData);
    if (response.statusCode !== 200) {
      log("Login failed. Check your username and password.");
      return null;
    } else {
      log("Login successful.");
      return response.body as LoginResult;
    }
  } catch (error: any) {
    log(`Connection error: ${error.message}`);
    return null;
  }
}

async function heartbeat(): Promise<boolean> {
  const postData = new URLSearchParams({
    username,
    os: "Chrome v133.0.0.0 on Windows 11 64-bit",
    speed: "1.0",
    newauth: "1",
  }).toString();

  try {
    const response = await doPost(serverUrlHeartbeat, postData);
    if (response.statusCode === 200) {
      log("Heartbeat successful.");
      return true;
    } else {
      log("Heartbeat failed.");
      return false;
    }
  } catch (error: any) {
    log(`Connection error: ${error.message}`);
    return false;
  }
}

async function checkConnection(): Promise<boolean> {
  try {
    const response = await axios.get(
      "https://detectportal.firefox.com/success.txt"
    );
    return response.status === 200 && response.data === "success\n";
  } catch {
    return false;
  }
}

async function start(): Promise<boolean> {
  let loginAttempts = 0;
  let firstConnect = true;

  const loginResult = await login();
  if (loginResult) await heartbeat();

  while (true) {
    log("Checking connection...");
    const isConnected = await checkConnection();
    log(`Connection status: ${isConnected ? "Connected" : "Disconnected"}`);
    if (isConnected) {
      if (firstConnect) {
        log(`Logged in as ${username}! Your IP: ${ipAddress}`);
        log(`Checking every ${timeRepeat / 1000} seconds.`);
        firstConnect = false;
      }

      const isHeartbeatSuccessful = await heartbeat();
      if (!isHeartbeatSuccessful) {
        await login();
      }

      await new Promise((resolve) => setTimeout(resolve, timeRepeat));
    } else {
      if (maxLoginAttempt > 0 && loginAttempts >= maxLoginAttempt) {
        log("Max login attempts reached. Restarting main...");
        return false;
      }
      await login();
      loginAttempts++;
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

async function main() {
  if (!username || !password) {
    log("Missing username, password. Set them in environment variables.");
    process.exit(1);
  }

  log(`Logging in with username '${username}'...`);

  const shouldRestart = await start();
  if (!shouldRestart) {
    await main();
  }
}

main();
