import sqlite3 from 'sqlite3';
import { axiosInstance, handleAxiosError } from './axiosInstance.js';
import moment from 'moment';
const sqlite_instance = sqlite3.verbose();

export function openDB() {
    let db = new sqlite_instance.Database('NHL.sqlite3', (error) => {
        if (error) {
            console.error('--- Failed to Instantiate SQLite: ', error.message);
        }
        else {
            console.log('Connected to SQLite Instance');
        }
    });
    return db;
}

export async function seedTeams() {
    let baseQuery = `INSERT INTO teams (id, teamName, abbreviation, firstYearOfPlay) VALUES `
    await axiosInstance.get('/teams').then((result, error) => {
        if( error ) {
            handleAxiosError(error, '/teams');
        }
        const teams = result.data.teams;
        teams.forEach((team, index) => {
            const { id, name, abbreviation, firstYearOfPlay }  = team;
            baseQuery += `("${id}", "${name}", "${abbreviation}", "${firstYearOfPlay}")`;
            baseQuery += (index != teams.length - 1 ? ', ' : '')
       });
       console.info(`running QUERY: `, baseQuery);
        db.all(baseQuery, [], async (err) => {
            if (err) {
                throw err;
            }
        });
    });
}
export async function seedGames(date = null) {
    let db = openDB();
    const queryUrl = date ? `/schedule?date=${date}`: '/schedule';
    let baseQuery = `INSERT INTO nhl_games (id, gameDate, homeTeamId, awayTeamId, gameType, season, gameStatus, formatted_date) VALUES `
    const formatted_date = date ? date : moment().format('YYYY-MM-DD');

    await axiosInstance.get(queryUrl).then((result, error) => {
        if( error ) {
            handleAxiosError(error, '/schedule');
        }
        const games = result.data.dates[0].games;
        games.forEach((game, index) => {
            const { gamePk, gameType, gameDate, season }  = game;
            const gameStatus = game.status.abstractGameState;
            const awayTeamId = game.teams.away.team.id;
            const homeTeamId = game.teams.home.team.id;
            baseQuery += `("${gamePk}", "${gameDate}", "${homeTeamId}", "${awayTeamId}", "${gameType}", "${season}", "${gameStatus}", "${formatted_date}")`;
            baseQuery += (index != games.length - 1 ? ', ' : '')
       });
       console.info(`running QUERY: `, baseQuery);
        db.all(baseQuery, [], async (err) => {
        if (err) {
            throw err;
        }
         });
    });
}

export function runSeeders() {
    try {
        seedGames();
        seedTeams();

    } catch (error) {
        console.error(`error running seeders: ` , error.message);
    }
}
