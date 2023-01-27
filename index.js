import hapi from 'hapi';
import moment from 'moment';
import { openDB, seedGames  } from './seeder.js';
import { axiosInstance, handleAxiosError } from './axiosInstance.js';

const GAME_STATUS_POLLING_INTERVAL = 30000;
const INDIVIDUAL_GAME_POLLING_INTERVAL = 5000;

/*
const initServer = async () => {
    const server = hapi.server({
        port: 8080,
        host: 'localhost'
    });
    server.route({
        method: 'GET',
        path: '/nhl/games/live',
        handler: (request, h) => {
            return 'Foo';
        }
    })
    await server.start();
    console.log(`Server running on ${server.info.uri}`);
}
*/

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

// check each of the players in the game for necessary updates
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
 * player entry {
 *  id: string;
 *  playerName: string;
 *  gameId: string;
 *  assists: int;
 *  goals: int;
 *  hits: int;
 *  penaltyMinutes: int;
 *  positionCode: string;
 * }
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
        // console.log('updates: ' , homeTeamUpdates, '& ', awayTeamUpdates);
        if(homeSQLUpdates.length || awaySQLUpdates.length) {
            const sqlUpdates = homeSQLUpdates.concat(awaySQLUpdates);
            let qrys = [];
            sqlUpdates.forEach((sqlUpdate, index) => {
                let qry =  `UPDATE nhl_game_player_meta SET `
                qry += `${sqlUpdate}`;
                qrys.push(qry)
            }); 
            db.all(qrys, (err, updates) => {
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
export function initializeGameData(gameId, game) {
    const awayTeamData = game.gameData.teams.away;
    const homeTeamData = game.gameData.teams.home;
    const venueData = game.gameData.venue;
    const mpPlayerIdToEntry = {};
    game.gameData.players.forEach((player) => {
        const { id, fullName, primaryNumber, currentAge, active, primaryPosition } = player;
        const currentTeamId = player.currentTeam.id;
        mpPlayerIdToEntry.put(id, player);
    });
    const playerIds = Object.keys(mpPlayerIdToEntry);
    db.each(`SELECT playerName, teamId, playerNumber, playerAge, primaryPositionCode FROM players WHERE id IN ${playerIds.join(',')}`, (err, player) => {
        if (err) {
            throw err;
        }
        const playerEntry = mpPlayerIdToEntry[player.id];
        if(player.playerName == playerEntry.fullName && player.playerNumber && playerEntry.primaryNumber && player.playerAge == playerEntry.currentAge && 
         player.primaryPositionCode == playerEntry.primaryPosition.code) {
            delete mpPlayerIdToEntry[player.id];
        }
    });
    if(Object.keys(mpPlayerIdToEntry).length > 0) {

    }
}

// Query for all games beginning TODAY. For games with status "LIVE", check if a process is being run to poll game stats
// If there is no such process, spin it up and update DB game status to "LIVE"
export function checkGameStartStatuses(db, games, now) {
    let rowsUpdated = false;
    if(games.length > 0) {
        console.log('checking for started games...');
        const mpIdToStatus = {};
        const gamesForStatusUpdate = [];
        db.all(`SELECT id, gameStatus FROM nhl_games WHERE formatted_date="2023-01-26"`, (err, games) => {
            console.log('in db all: ', games);

            if (err) {
                throw err;
            }
            games.forEach((game) => {
                mpIdToStatus.put(game.id, game.gameStatus);
            });
        });
    
        games.forEach((game) => {
            const dbGameStatus = mpIdToStatus[game.gamePk];
            console.log('dbGameStatus: ', dbGameStatus);
            if(dbGameStatus && dbGameStatus !== game.status.abstractGameState && game.status.abstractGameState === 'Live') {
                gamesForStatusUpdate.push(game.gamePk);
                //initializeGameData(game.gamePk, game);
            }
        });
        if(gamesForStatusUpdate.length > 0) {
            db.run(`UPDATE nhl_games SET gameStatus="Live" WHERE id IN (${gamesForStatusUpdate.join(",")})`, (err) => {
                if(err) {
                    throw new Error('failed to update for game status: ', error);
                }
                else {
                    rowsUpdated = true;
                }
            });
        }
        else {
            console.log('no game starts to update for this interval');
        }
    }
    else {
        console.log('no games currently LIVE');
    }
    return rowsUpdated;
}

// Reverse of checkGameStartStatuses; check for updates from "LIVE" to "FINAL"
// Find the associate process to query for game updates and end it, update DB game status to "FINAL"
export function checkGameEndStatuses(db, games) {
    const gamesUpdated = false;
    if(games.length > 0) {
        console.log('checking for games ending...');
        const gameIds = [];
        const gamesForStatusUpdate = [];
        db.each(`SELECT id FROM nhl_games WHERE gameStatus="Live"`, (err, game) => {
            if (err) {
                throw err;
            }
            console.log('FOUND GAME: ', game);
            gameIds.push(game.id);
        });
    
        games.forEach((game) => {
            if(gameIds.findIndex((gid) => { return gid === game.gamePk}) !== -1 && game.status.abstractGameState == 'Final') {
                console.log(`game ${game.gamePk} has ended, terminating process.`);
                gamesForStatusUpdate.push(game.gamePk);
            }
        });
        if(gamesForStatusUpdate.length > 0) {
            db.run(`UPDATE nhl_games SET gameStatus="Final" WHERE id IN (${gamesForStatusUpdate.join(",")})`, (err, update) => {
                if(err) {
                    throw new Error('failed to update for game status: ', error);
                }
                rowsUpdated = true;
            });
        }
        else {
            console.log('no game finals to update for this interval');
        }
    }
    else {
        console.log('no games finished today (yet)');
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
    process.on('unhandledRejection', (err) => {
        console.error(`Unhandled Rejection in CHILD Process: ${err}`);
        process.exit(1);
    });
    let db = openDB();
    let mpPlayerEntries = createPlayerEntryMap(gameId);

    setInterval(() => {
        checkForGameDataUpdates(db, gameId, mpPlayerEntries)
    },
    INDIVIDUAL_GAME_POLLING_INTERVAL);

}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
 }

for (var i=0; i<process.argv.length;i++) {
    switch (process.argv[i]) {
        case "main":
            main();
        break;
        case "child":
            child(process.argv[i+1]);
        case "seed":
            seedGames();
        break;
    }
}
/*
let db = openDB();
db.all(`SELECT id, gameStatus FROM nhl_games WHERE formatted_date="2023-01-26"`, (err, rows) => {
    console.log('err: ', err);
    console.log('data: ', rows);
});
await sleep(3000);
*/
