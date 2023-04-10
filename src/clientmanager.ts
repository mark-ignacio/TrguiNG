/**
 * transgui-ng - next gen remote GUI for transmission torrent daemon
 * Copyright (C) 2022  qu1ck (mail at qu1ck.org)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { SessionStatistics } from "rpc/transmission";
import { Config } from "./config";
import { SessionInfo, TransmissionClient } from "./rpc/client";
import { Torrent } from "./rpc/torrent";

const ClientTimerTypes = ["torrents", "details", "session", "sessionstats"] as const;
type ClientTimerType = typeof ClientTimerTypes[number];

interface ServerEntry {
    client: TransmissionClient;
    torrents: Torrent[];
    torrentDetails?: Torrent;
    session: SessionInfo;
    sessionStats?: SessionStatistics;
    timers: Record<ClientTimerType, number>;
    detailsId?: number;
}

export class ClientManager {
    servers: Record<string, ServerEntry> = {};
    activeServer?: string;
    onTorrentsChange?: (torrents: Torrent[]) => void;
    onTorrentDetailsChange?: (torrent?: Torrent) => void;
    onSessionChange?: (session: SessionInfo) => void;
    onSessionStatsChange?: (sessionStats: SessionStatistics) => void;
    config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    open(server: string) {
        if (server in this.servers) return;

        var serverConfig = this.config.getServer(server)!;
        this.servers[server] = {
            client: new TransmissionClient(serverConfig.connection),
            torrents: [],
            session: {},
            timers: {
                torrents: -1,
                details: -1,
                session: -1,
                sessionstats: -1,
            }
        }
        this.servers[server].client.getSessionFull();
        this.startTimers(server);
    }

    close(server: string) {
        if (!(server in this.servers)) return;
        this.stopTimers(server);
        delete this.servers[server];
    }

    startTimers(server: string) {
        if (!(server in this.servers)) return;

        if (this.servers[server].timers.torrents >= 0 &&
            this.servers[server].timers.session >= 0) return;

        const updateTorrents = () => {
            let srv = this.servers[server];
            const reschedule = () => {
                // TODO make timeout configurable
                if (srv.timers.torrents >= 0) {
                    srv.timers.torrents = setTimeout(updateTorrents, 5000);
                }
            }
            srv.client.getTorrents().then((torrents) => {
                if (this.onTorrentsChange !== undefined && this.activeServer == server)
                    this.onTorrentsChange(torrents);
                // TODO calc diff on torrents and send notifications
                srv.torrents = torrents;
                reschedule();
            }).catch((e) => {
                console.log("Error fetching torrents", e);
                reschedule();
            });
        }

        const updateSession = () => {
            let srv = this.servers[server];
            const reschedule = () => {
                // TODO make timeout configurable
                if (srv.timers.session >= 0) {
                    srv.timers.session = setTimeout(updateSession, 5000);
                }
            }
            srv.client.getSession().then((session) => {
                if (this.onSessionChange !== undefined && this.activeServer == server)
                    this.onSessionChange(session);
                srv.session = session;
                reschedule();
            }).catch((e) => {
                console.log("Error fetching session info", e);
                reschedule();
            });
        }

        this.servers[server].timers.torrents = 0;
        this.servers[server].timers.session = 0;

        updateTorrents.bind(this)();
        updateSession.bind(this)();

        if(this.servers[server].torrentDetails)
            this.startDetailsTimer(server);
        if(this.onSessionStatsChange)
            this.startSessionStatsTimer(server);
    }

    startDetailsTimer(server: string) {
        if (this.servers[server].timers.details >= 0) return;

        const updateDetails = () => {
            let srv = this.servers[server];
            if (srv.detailsId === undefined) return;
            const reschedule = () => {
                // TODO make timeout configurable
                if (srv.timers.details >= 0) {
                    srv.timers.details = setTimeout(updateDetails, 5000);
                }
            }
            srv.client.getTorrentDetails(srv.detailsId).then((torrent) => {
                if (srv.detailsId != torrent.id) return;
                if (this.onTorrentDetailsChange !== undefined && this.activeServer == server)
                    this.onTorrentDetailsChange(torrent);
                srv.torrentDetails = torrent;
                reschedule();
            }).catch((e) => {
                console.log("Error fetching torrent details", e);
                if (this.onTorrentDetailsChange !== undefined)
                    this.onTorrentDetailsChange(undefined);
                reschedule();
            });
        }
        this.servers[server].timers.details = 0;

        updateDetails.bind(this)();
    }

    startSessionStatsTimer(server: string) {
        if (this.servers[server].timers.sessionstats >= 0) return;

        const updateSessionStats = () => {
            let srv = this.servers[server];
            const reschedule = () => {
                // TODO make timeout configurable
                if (srv.timers.sessionstats >= 0) {
                    srv.timers.sessionstats = setTimeout(updateSessionStats, 5000);
                }
            }
            srv.client.getSessionStats().then((stats) => {
                console.log("Got stats")
                if (this.onSessionStatsChange !== undefined && this.activeServer == server)
                    this.onSessionStatsChange(stats);
                srv.sessionStats = stats;
                reschedule();
            }).catch((e) => {
                console.log("Error fetching session stats", e);
                reschedule();
            });
        }
        this.servers[server].timers.sessionstats = 0;

        updateSessionStats.bind(this)();
    }

    stopSessionStatsTimer(server: string) {
        if (!(server in this.servers)) return;
        var srv = this.servers[server];
        if(srv.timers.sessionstats >= 0)
            clearTimeout(srv.timers.sessionstats);
        srv.timers.sessionstats = -1;
    }

    stopTimers(server: string) {
        if (!(server in this.servers)) return;
        var srv = this.servers[server];

        for (var t of ClientTimerTypes) {
            if (srv.timers[t] >= 0) {
                clearTimeout(srv.timers[t]);
                srv.timers[t] = -1;
            }
        }
    }

    setActiveServer(server: string | undefined) {
        this.activeServer = server;
    }

    setServerDetailsId(server: string, id: number | undefined) {
        if (!(server in this.servers)) return;

        var srv = this.servers[server];
        srv.detailsId = id;

        if (srv.timers.details >= 0) {
            clearTimeout(srv.timers.details);
            srv.timers.details = -1;
            this.startDetailsTimer(server);
        }
    }

    getClient(server: string) {
        return this.servers[server].client;
    }

    getHostname(server: string) {
        return this.servers[server].client.hostname;
    }
}
