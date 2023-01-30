## Description
    An nhl game data consumer designed to keep live track of player stats such as goals, assists, etc.

## Initializing the Database
    A sql.init file is provided which contains the queries needed to make the necessary tables for this project. For this project, I used open table to create the database and run the SQL commands contained in SQL.init.

## Setup
    As with most node servers, make sure to run `npm i` first.
    Run `npm run start seed` to initialize the data seeder. This is will grab the games currently scheduled for today, and is meant to simulate a CRON job of similar function.

## Running the server
    Use `npm run start main` to activate the server and call the main function contained therein. This will start the polling process for game status updates whcih should run 
    on a 30-second interval.

## Running Tests
    `npm run test` should run the test suite, contained within index.test.js; any other *.test.js files added at a future date will also be run via this command.