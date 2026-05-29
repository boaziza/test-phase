const { Client, Databases, Teams, Users, ID, Query } = require('node-appwrite');

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db     = new Databases(client);
const teams  = new Teams(client);
const users  = new Users(client);

module.exports = { client, db, teams, users, ID, Query };
