
jest.useFakeTimers();
import mockScheduleData from './mock-data/mock-game-schedule.json';
import mockLiveFeedData from './mock-data/mock-live-feed.json';
import { doesPlayerNeedUpdate, checkForPlayerUpdates, checkForGameDataUpdates, checkGameStartStatuses, checkGameEndStatuses } from './index.js';
import { axiosInstance } from './axiosInstance.js';
import moment from 'moment';


describe('Ensure that status updates occur properly when games statuses change ', () => {
    beforeEach(() => {
        axiosInstance.get = jest.fn();
        axiosInstance.get.mockImplementation(() => Promise.resolve({ 
        data: {
            
         }
        }));
    });
    test('It should update game status once the game is live', () => {
        const db = jest.mock();
        const now = moment().format('YYYY-MM-DD');
        const liveGames = [{
            gamePk: "foo",
            status: {
                abstractGameState: "Live"
            }
        }];
        db.run = jest.fn();
        db.run.mockImplementation(() => {
            Promise.resolve({changes: 1});
        });

        db.all = jest.fn();
        db.all.mockImplementation(()=> {
            Promise.resolve({
                error: null, 
                rows: [{id: 'foo', gameStatus: 'Live'}] 
            });
        });

        const rowsUpdated = checkGameStartStatuses(db, liveGames, now);
        expect(rowsUpdated).toBeDefined();
        // expect(rowsUpdated).toBeTruthy();
    });

    test('It should update game status once the game is final', () => {
        const db = jest.mock();
        const finalGames = [{
            gamePk: "foo",
            status: {
                abstractGameState: "Final"
            }
        }];
        db.run = jest.fn();
        db.run.mockImplementation(() => {
            Promise.resolve({changes: 1});
        });

        db.each = jest.fn();
        db.each.mockImplementation(() => {
            Promise.resolve({
                error: null,
                game: [{id: 'foo', gameStatus: 'Live'}]
            });
        });

        const rowsUpdated = checkGameEndStatuses(db, finalGames);
        expect(rowsUpdated).toBeDefined();
        // expect(rowsUpdated).toBeTruthy();
    });
});

describe('Ensure that the system properly detects when updates are needed', () => {
    test('doesPlayerNeedUpdate:: It should return true if a players stats need updated', () => {
        const playerToTest =  mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947;
        let playerEntry = {
            id: playerToTest.person.id,
            playerName: playerToTest.person.fullName,
            gameId: 2022020773,
            assists: 0, 
            goals: 0,
            hits: 0,
            shots: 0,
            penaltyMinutes: 0,
            positionCode: 'L'
        }
        let teamPlayerStats = mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947.stats.skaterStats;
        expect(doesPlayerNeedUpdate(playerEntry, teamPlayerStats)).toBeTruthy();

    });
    test('doesPlayerNeedUpdate:: It should return false if no updates are required', () => {
        const playerToTest =  mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947;
        let playerEntry = {
            id: playerToTest.person.id,
            playerName: playerToTest.person.fullName,
            gameId: 2022020773,
            assists: 1, 
            goals: 0,
            hits: 0,
            shots: 0,
            penaltyMinutes: 0,
            positionCode: 'L'
        }
        let teamPlayerStats = mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947.stats.skaterStats;
        expect(doesPlayerNeedUpdate(playerEntry, teamPlayerStats)).toBeFalsy();

    });
});

describe('Ensure that valid update rows are furnished', () => {
    test('checkForPlayerUpdates:: It should return a list of SQL rows for update when player entries differ', () => {
        const playerToTest =  mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947;
        const teamPlayers = {ID8477947: playerToTest};
        let mpPlayerEntries = {};
        mpPlayerEntries[playerToTest.person.id] = {
            id: playerToTest.person.id,
            playerName: playerToTest.person.fullName,
            gameId: 2022020773,
            assists: 0, 
            goals: 0,
            hits: 0,
            shots: 0,
            penaltyMinutes: 0,
            positionCode: 'L'
        }
        const playerSqlUpdates = checkForPlayerUpdates(mpPlayerEntries, teamPlayers).playerSqlUpdates;
        expect(playerSqlUpdates.length).toBe(1);
    });
    test('checkForPlayerUpdates:: It should return an empty list when no updates are required', () => {
        const playerToTest =  mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947;
        const teamPlayers = {ID8477947: playerToTest};
        let mpPlayerEntries = {};
        mpPlayerEntries[playerToTest.person.id] = {
            id: playerToTest.person.id,
            playerName: playerToTest.person.fullName,
            gameId: 2022020773,
            assists: 1, 
            goals: 0,
            hits: 0,
            shots: 0,
            penaltyMinutes: 0,
            positionCode: 'L'
        }
        const playerSqlUpdates = checkForPlayerUpdates(mpPlayerEntries, teamPlayers).playerSqlUpdates;

        expect(playerSqlUpdates.length).toBe(0);
    });
});

describe('Ensure that valid update rows are furnished', () => {
    beforeEach(() => {
        
        axiosInstance.get = jest.fn();
        axiosInstance.get.mockImplementation(() => Promise.resolve({ 
        data: {
            liveData: {
                boxscore: {
                    teams: {
                        home: {
                            players: {
                                ID8477947: mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947
                            }
                        },
                        away: {
                            players: []
                        }
                    }
                }
            }
         }
        }));
    });
    test('checkForGameDataUpdates:: It should return a list of SQL rows for update when player entries differ', async () => {
        const db = jest.mock();
        db.all = jest.fn();
        db.all.mockImplementation(() => {
            Promise.resolve({
                error: null,
                updates: 1
            });
        });
        const playerToTest =  mockLiveFeedData.liveData.boxscore.teams.home.players.ID8477947;
        const teamPlayers = [playerToTest];
        let mpPlayerEntries = {};
        mpPlayerEntries[playerToTest.person.id] = {
            id: playerToTest.person.id,
            playerName: playerToTest.person.fullName,
            gameId: 2022020773,
            assists: 0, 
            goals: 0,
            hits: 0,
            shots: 0,
            penaltyMinutes: 0,
            positionCode: 'L'
        }

        const mpPlayerEntriesDelta = await checkForGameDataUpdates(db, 2022020773, mpPlayerEntries);
        expect(mpPlayerEntriesDelta[playerToTest.person.id].assists).toEqual(1);
    });
});

