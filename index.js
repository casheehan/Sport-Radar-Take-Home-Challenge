import moment from 'moment';
import { openDB, seedGames  } from './seeder.js';
import { axiosInstance, handleAxiosError } from './axiosInstance.js';
import { spawn } from 'child_process';

const GAME_STATUS_POLLING_INTERVAL = 30000;
const INDIVIDUAL_GAME_POLLING_INTERVAL = 5000;


// Check whether specific player meta data fields need updated
export function doesPlayerNeedUpdate(playerEntry, teamPlayerStats) {
    if(playerEntry.assists !== teamPlayerStats.assists)
        return true;
    if(playerEntry.goals !== teamPlayerStats.goals)
        return true;
    if(playerEntry.shots !== teamPlayerStats.shots)
        return true;
    if(playerEntry.hits !== teamPlayerStats.hits)
        return true;
    if(playerEntry.penaltyMinutes !== teamPlayerStats.penaltyMinutes)
        return true;
    return false;
}

export function createPlayerEntryMap(db, gameId) {
    const playerMap = {};
    const sql = `SELECT * from nhl_game_player_meta WHERE gameId="${gameId}"`;
    db.each(sql, (error, player) => {
        if (error) {
            throw new Error(`error initializing player map: ${error}`);
        }
        playerMap[player] = player;
    });
    return playerMap;
}

// Check each of the players in the game for necessary updates
export function checkForPlayerUpdates(mpPlayerEntries, teamPlayers) {
    const playerSqlUpdates = [];
    Object.keys(teamPlayers).forEach((teamPlayerKey) => {
        const teamPlayer = teamPlayers[teamPlayerKey];
        const teamPlayerId = teamPlayer.person.id;
        const playerEntry = mpPlayerEntries[teamPlayerId];
        const teamPlayerStats = teamPlayer.stats.skaterStats
        if (! playerEntry) {
            throw new Error('attempt to update non-initialized player');
        }
        if(doesPlayerNeedUpdate(playerEntry, teamPlayerStats)) {
            playerEntry.assists = teamPlayerStats.assists;
            playerEntry.goals = teamPlayerStats.goals;
            playerEntry.shots = teamPlayerStats.shots;
            playerEntry.hits = teamPlayerStats.hits;
            playerEntry.penaltyMinutes = teamPlayerStats.penaltyMinutes;
            
            playerSqlUpdates.push(`assits=${playerEntry.assists},goals=${playerEntry.goals}, shots=${playerEntry.shots}, hits=${playerEntry.hits}, penaltyMinutes=${playerEntry.penaltyMinutes} WHERE playerId=${playerEntry.id} AND gameId=${playerEntry.gameId};`);
        }
    });
    return {mpPlayerEntries, playerSqlUpdates}
}

/* Check for game data updates, such as player goals, asssits, hits, etc.
 * Update the corresponding DB entries for these players as well as their cached entries
 */
export async function checkForGameDataUpdates(db, gameId, mpPlayerEntries) {
    await axiosInstance.get(`/game/${gameId}/feed/live`).then((response, error) => {
        if (error) {
            handleAxiosError(`/game/${gameId}/feed/live`);
        }
        const game = response.data;
        const homePlayers = game.liveData.boxscore.teams.home.players;
        const awayPlayers = game.liveData.boxscore.teams.away.players;
        const homeTeamUpdates  =  checkForPlayerUpdates(mpPlayerEntries, homePlayers);
        mpPlayerEntries = homeTeamUpdates.mpPlayerEntries;
        const awayTeamUpdates = checkForPlayerUpdates(mpPlayerEntries, awayPlayers);
        mpPlayerEntries = awayTeamUpdates.mpPlayerEntries;
        const homeSQLUpdates = homeTeamUpdates.playerSqlUpdates, awaySQLUpdates = awayTeamUpdates.playerSqlUpdates;
        if(homeSQLUpdates.length || awaySQLUpdates.length) {
            const sqlUpdates = homeSQLUpdates.concat(awaySQLUpdates);
            let qrys = [];
            sqlUpdates.forEach((sqlUpdate) => {
                let qry =  `UPDATE nhl_game_player_meta SET `
                qry += `${sqlUpdate}`;
                qrys.push(qry)
            }); 
            db.all(qrys, (err) => {
                if (err) {
                    throw new Error(`Error with bulk update player entries: `, err.message);
                }
            });
        }
    });
    return mpPlayerEntries;
}


// Given a game that has just gone LIVE, It should propegate the basic information about the game to nhl_game_meta table
// This includes: team information and player rosters for both home and away teams
export function initializeGameData(db, gameId, game) {
    try{
        const queries = [];
        const mpPlayerIdToEntry = {};
        Object.keys(game.gameData.players).forEach((playerKey) => {
            const player = game.gameData.players[playerKey];
            const { id, fullName, primaryNumber, currentAge, primaryPosition } = player;
            const currentTeamId = player.currentTeam.id;
            const primaryPositionCode = primaryPosition.code;
            mpPlayerIdToEntry[id] =  player;

            let sql = `INSERT INTO players (playerId, playerName, teamId, playerAge, playerNumber, primaryPositionCode) VALUES `;
            sql+= `(${id}, "${fullName}", ${currentTeamId}, ${currentAge}, ${primaryNumber}, ${primaryPositionCode}) `;
            sql += `ON CONFLICT(playerId) DO UPDATE SET playerAge=${currentAge}, teamId=${currentTeamId} playerNumber=${primaryNumber}, primaryPositionCode="${primaryPositionCode}";`;


            let sql2 = `INSERT INTO nhl_game_player_meta (playerId, teamId, gameId, positionCode) VALUES `
            sql2 += `(${id}, ${currentTeamId}, ${gameId}, "${primaryPositionCode}");`;
            queries.push(sql, sql2);
        });
        // now run all the queries to initalize the two tables
        let succeses = 0, errors = 0;
        queries.forEach((qry) => {
            db.run(qry, (err) => {
                if(err) {
                    errors++;
                }
                else {
                    succeses++;
                }
            });
        });
        console.info(`Attempt to insert player data resulted in ${succeses} succeses, ${errors} errors`)
    } catch (error) {
        console.error('Failed to init game data: ', error);
    }
}
//Used to update the "*lineScore" values in the nhl_games table to reflect the final score (including shootouts)
/*export function finalizeGameData(db, game) {

}
*/

// Query for all games beginning TODAY. For games with status "LIVE", check if a process is being run to poll game stats
// If there is no such process, spin it up and update DB game status to "LIVE"
export function checkGameStartStatuses(db, games, now) {
    let rowsUpdated = false;
    if(games.length > 0) {
        try {
            console.info('checking for started games...');
            const mpIdToStatus = {};
            const gamesForStatusUpdate = [];
            db.all(`SELECT id, gameStatus FROM nhl_games WHERE formatted_date="${now}"`, (err, rows) => {

                if (err) {
                    throw err;
                }
                rows.data.forEach((game) => {
                    mpIdToStatus[game.id] =  game.gameStatus;
                });
            });
        
            games.forEach((game) => {
                const dbGameStatus = mpIdToStatus[game.gamePk];
                if(dbGameStatus && dbGameStatus !== game.status.abstractGameState && game.status.abstractGameState === 'Live') {
                    gamesForStatusUpdate.push(game.gamePk);
                    initializeGameData(db, game.gamePk, game);
                    spawn('node', ['index.js', 'child', game.gamePk]);
                    
                }
            });
            if(gamesForStatusUpdate.length > 0) {
                db.run(`UPDATE nhl_games SET gameStatus="Live" WHERE id IN (${gamesForStatusUpdate.join(",")})`, (err) => {
                    if(err) {
                        throw new Error('failed to update for game status: ', err);
                    }
                    else {
                        rowsUpdated = true;
                    }
                });
            }
            else {
                console.info('no game starts to update for this interval');
            }
        } catch (error) {
            console.error(`error checking for game starts: ${error.message}`);
        }
    }
    else {
        console.info('no games currently LIVE');
    }
    return rowsUpdated;
}

// Reverse of checkGameStartStatuses; check for updates from "LIVE" to "FINAL"
// Find the associate process to query for game updates and end it, update DB game status to "FINAL"
export function checkGameEndStatuses(db, games) {
    let gamesUpdated = false;
    try {
        if(games.length > 0) {
            console.info('checking for games ending...');
            const gameIds = [];
            const gamesForStatusUpdate = [];
            db.each(`SELECT id FROM nhl_games WHERE gameStatus="Live"`, (err, game) => {
                if (err) {
                    throw err;
                }
                gameIds.push(game.id);
            });
        
            games.forEach((game) => {
                if(gameIds.findIndex((gid) => { return gid === game.gamePk}) !== -1 && game.status.abstractGameState == 'Final') {
                    console.log(`game ${game.gamePk} has ended, terminating process.`);
                    gamesForStatusUpdate.push(game.gamePk);
                }
            });
            if(gamesForStatusUpdate.length > 0) {
                db.run(`UPDATE nhl_games SET gameStatus="Final" WHERE id IN (${gamesForStatusUpdate.join(",")})`, (err) => {
                    if(err) {
                        throw new Error('failed to update for game status: ', err);
                    }
                    gamesUpdated = true;
                });
            }
            else {
                console.info('no game finals to update for this interval');
            }
        }
        else {
            console.info('no games finished today (yet)');
        }
    } catch (error) {
        console.error(`error checking for game end statuses: `, error);
    }
    return gamesUpdated;
}

export function checkGameStatuses(db) {
    const now = moment().format('YYYY-MM-DD');

    try {
        axiosInstance.get(`/schedule?date=${now}`).then((response, error) => {
            if(error) {
                handleAxiosError(error, '/schedule');
            }
            const games = response.data?.dates[0].games;
            console.log('found: ', games.length, ' games');
            const liveGames = games.filter((game) => {return game.status.abstractGameState === 'Live '});
            const finishedGames = games.filter((game) => {return game.status.abstractGameState === 'Final '});
            checkGameStartStatuses(db, liveGames, now);
            checkGameEndStatuses(db, finishedGames);
        });
    } catch (error) {
        console.log('error checking game statuses, will retry again in ', (GAME_STATUS_POLLING_INTERVAL / 1000), ' seconds');
        console.log(error);
    }
   
}

function main() {
    console.log('running main');
    process.on('unhandledRejection', (err) => {
        console.error(`Unhandled Rejection: ${err}`);
        process.exit(1);
    });
    
    let db = openDB();
    checkGameStatuses(db) 
    setInterval(() => {
        checkGameStatuses(db) 
    },
    GAME_STATUS_POLLING_INTERVAL);
}

function child(gameId) {
    console.info('created child process for game: ', gameId);
    process.on('unhandledRejection', (err) => {
        console.error(`Unhandled Rejection in CHILD Process: ${err}`);
        process.exit(1);
    });
    let db = openDB();
    let mpPlayerEntries = createPlayerEntryMap(db, gameId);

    setInterval(() => {
        checkForGameDataUpdates(db, gameId, mpPlayerEntries)
    },
    INDIVIDUAL_GAME_POLLING_INTERVAL);

}

for (var i=0; i<process.argv.length;i++) {
    switch (process.argv[i]) {
        case "main":
            main();
        break;
        case "child":
            child(process.argv[i+1]);
        break;
        case "seed":
            seedGames();
        break;
    }
}

