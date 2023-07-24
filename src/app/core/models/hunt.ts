export interface Hunt {
    id: number;
    owner: number;
    name: string;
    description: string;
    longid: string;
    location: string;
    begin: string;
    end: string;
    award: string;
    mode: number;
    contribution: number;
    public: number;
    status: number;
    teamgame: number;
    creation: Date;
    lastupdate: Date;
}