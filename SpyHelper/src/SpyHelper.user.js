// ==UserScript==
// @name         SpyHelper
// @version      2.1.6
// @description  A script that adds useful information to espionage reports.
// @author       Amuxix
// @updateURL    https://web.tecnico.ulisboa.pt/samuel.a.martins/SpyHelper.user.js
// @downloadURL  https://web.tecnico.ulisboa.pt/samuel.a.martins/SpyHelper.user.js
// @grant        none
// @include      http*.ogame.gameforge.com/game/index.php?page=messages*
// @include      http*.ogame.gameforge.com/game/index.php?page=ingame&component=fleetdispatch*
// @include      http*.ogame.gameforge.com/game/index.php?page=ingame&component=research*
// @include      http*.ogame.gameforge.com/game/index.php?page=ingame&component=galaxy*
// ==/UserScript==
/* TODO
 * Add Ships that are being repaired
 * Delay fetches to avoid DC
 * Add IPMs required to break defences
 * Scale defence score with techs
 * Make tables size fixed
 * Delete old details from repository as they might have been deleted from the server
 * Use energy on production calculation
 * Color report age
 * Button to delete older copies of the same guy
 * Sort by player and coordinates
 * Button to spy and delete report
 * Sort by player status, this makes it easy to delete all noobs for example
 * Add info about more waves somewhere
 * Fix pre-select ships
 * Apply the spy helper to the trash.
 */
const SCRIPT_NAME = 'SpyHelper';
const UNIVERSE = document.getElementsByName('ogame-universe')[0].content;
const DELAY_BETWEEN_DELETES = 150;
//Other Constant
const SHORT_SCALE = ['k', 'M', 'B', 'T', 'Q'];
const AVERAGE_TEMP = [220, 170, 120, 70, 60, 50, 40, 30, 20, 10, 0, -10, -50, -90, -130];
const FLEET_SECTION = "ships";
const DEFENCES_SECTION = "defense";
const BUILDINGS_SECTION = "buildings";
const RESEARCHES_SECTION = "research";
//Icon classes
const SIM_ICON = 'sim';
const LARGE_CARGO_ICON = 'large_cargo';
const SMALL_CARGO_ICON = 'small_cargo';
const ESPIONAGE_PROBE_ICON = 'probe';
const EXPEDITION = 15;
//Mission IDs
const COLONIZE = 7;
const RECYCLE = 8;
const TRANSPORT = 3;
const DEPLOY = 4;
const ESPIONAGE = 6;
const ACS_DEFEND = 5;
const ATTACK = 1;
const ACS_ATTACK = 2;
const MOON_DESTROY = 9;
//Type IDs
const PLANET = 1;
const DEBRIS_FIELD = 2;
const MOON = 3;

const NOW = new Date();

class Serializable {
    toJson() {
        throw `toJson not implement for ${this.constructor.name}`
    }

    static fromJson(json) {
        throw `fromJson not implement for ${this.name}`
    }
}

class HashCodeMap {
    #map = new BetterMap();

    set(key, value) {
        return this.#map.set(key.hashCode(), value)
    }

    get(key) {
        return this.#map.get(key.hashCode())
    }

    delete(key) {
        return this.#map.delete(key.hashCode())
    }

    keys() {
        return this.#map.keys()
    }

    values() {
        return this.#map.values()
    }

    /**
     *
     * @param zero {B}
     * @param op {function(acc: B, key: K, value: V): B}
     * @returns {*}
     * @template B, K, V
     */
    fold(zero, op) {
        return this.#map.fold(zero, op);
    }

    getOrElse(key, defaultValue) {
        return this.#map.getOrElse(key, defaultValue);
    }

    /**
     * @param predicate {function(key: K): Boolean}
     * @template K
     */
    filterKeys(predicate) {
        return this.#map.filterKeys(predicate);
    }
}

class BetterMap extends Map {
    constructor() {
        super();
    }

    /**
     *
     * @param zero {B}
     * @param op {function(acc: B, key: K, value: V): B}
     * @returns {*}
     * @template B, K, V
     */
    fold(zero, op) {
        let acc = zero;
        this.forEach((value, key) => {
            acc = op(acc, key, value);
        });
        return acc;
    }

    getOrElse(key, defaultValue) {
        return this.get(key) || defaultValue;
    }

    /**
     * @param predicate {function(key: K): Boolean}
     * @template K
     */
    filterKeys(predicate) {
        return this.fold(new BetterMap(), (acc, key, value) => {
            if (predicate(key)) {
                acc.set(key, value);
            }
            return acc;
        })
    }
}

class Entity {
    #id;
    #name;
    #metalCost;
    #crystalCost;
    #deuteriumCost;

    constructor(id, name, metalCost, crystalCost, deuteriumCost) {
        this.#id = id;
        this.#name = name;
        this.#metalCost = metalCost;
        this.#crystalCost = crystalCost;
        this.#deuteriumCost = deuteriumCost;
    }

    get id() {
        return this.#id;
    }

    get name() {
        return this.#name;
    }

    get metalCost() {
        return this.#metalCost;
    }

    get crystalCost() {
        return this.#crystalCost;
    }

    get deuteriumCost() {
        return this.#deuteriumCost;
    }
}

class Ship extends Entity {
    #capacity;

    constructor(id, name, metalCost, crystalCost, deuteriumCost, capacity) {
        super(id, name, metalCost, crystalCost, deuteriumCost);
        this.#capacity = capacity;
    }

    get capacity() {
        return this.#capacity * (1 + 0.05 * SpyHelper.saves.researches.levelOf(HYPERSPACE_TECHNOLOGY));
    }

    static fromName(shipName) {
        switch (shipName) {
            case LIGHT_FIGHTER.name:
                return LIGHT_FIGHTER;
            case HEAVY_FIGHTER.name:
                return HEAVY_FIGHTER;
            case CRUISER.name:
                return CRUISER;
            case BATTLESHIP.name:
                return BATTLESHIP;
            case BATTLECRUISER.name:
                return BATTLECRUISER;
            case BOMBER.name:
                return BOMBER;
            case DESTROYER.name:
                return DESTROYER;
            case DEATHSTAR.name:
                return DEATHSTAR;
            case REAPER.name:
                return REAPER;
            case PATHFINDER.name:
                return PATHFINDER;
            case SMALL_CARGO.name:
                return SMALL_CARGO;
            case LARGE_CARGO.name:
                return LARGE_CARGO;
            case COLONY_SHIP.name:
                return COLONY_SHIP;
            case RECYCLER.name:
                return RECYCLER;
            case ESPIONAGE_PROBE.name:
                return ESPIONAGE_PROBE;
            case SOLAR_SATELLITE.name:
                return SOLAR_SATELLITE;
            case CRAWLER.name:
                return CRAWLER;
            default:
                throw `Could not find a Ship named ${shipName}`
        }
    }
}

class Defence extends Entity {
    #structuralIntegrity;
    #shield;
    #damage;
    constructor(id, name, metalCost, crystalCost, deuteriumCost, structuralIntegrity, shield, damage) {
        super(id, name, metalCost, crystalCost, deuteriumCost);
        this.#structuralIntegrity = structuralIntegrity;
        this.#shield = shield;
        this.#damage = damage;
    }


    get structuralIntegrity() {
        return this.#structuralIntegrity;
    }

    get shield() {
        return this.#shield;
    }

    get damage() {
        return this.#damage;
    }

    static fromName(defenceName) {
        switch (defenceName) {
            case ROCKET_LAUNCHER.name:
                return ROCKET_LAUNCHER;
            case LIGHT_LASER.name:
                return LIGHT_LASER;
            case HEAVY_LASER.name:
                return HEAVY_LASER;
            case GAUSS_CANNON.name:
                return GAUSS_CANNON;
            case ION_CANNON.name:
                return ION_CANNON;
            case PLASMA_TURRET.name:
                return PLASMA_TURRET;
            case SMALL_SHIELD_DOME.name:
                return SMALL_SHIELD_DOME;
            case LARGE_SHIELD_DOME.name:
                return LARGE_SHIELD_DOME;
            case ANTI_BALLISTIC_MISSILES.name:
                return ANTI_BALLISTIC_MISSILES;
            case INTERPLANETARY_MISSILES.name:
                return INTERPLANETARY_MISSILES;
            default:
                throw `Could not find a Defence named ${defenceName}`
        }
    }

    get defenceScore() {
        return (this.structuralIntegrity / 10 + this.shield * 6 + this.damage * 6) / 1000;
    }
}

class Missile extends Defence {
    constructor(id, name, metalCost, crystalCost, deuteriumCost, structuralIntegrity, shield, damage) {
        super(id, name, metalCost, crystalCost, deuteriumCost, structuralIntegrity, shield, damage);
    }

    get defenceScore() {
        return 0;
    }
}

class Building extends Entity {
    constructor(id, name) {
        super(id, name, 0, 0, 0);
    }
    static fromName(buildingName) {
        switch (buildingName) {
            case METAL_MINE.name:
                return METAL_MINE;
            case METAL_STORAGE.name:
                return METAL_STORAGE;
            case CRYSTAL_MINE.name:
                return CRYSTAL_MINE;
            case CRYSTAL_STORAGE.name:
                return CRYSTAL_STORAGE;
            case DEUTERIUM_SYNTHESIZER.name:
                return DEUTERIUM_SYNTHESIZER;
            case DEUTERIUM_TANK.name:
                return DEUTERIUM_TANK;
            case SOLAR_PLANT.name:
                return SOLAR_PLANT;
            case FUSION_REACTOR.name:
                return FUSION_REACTOR;
            case ROBOTICS_FACTORY.name:
                return ROBOTICS_FACTORY;
            case NANITE_FACTORY.name:
                return NANITE_FACTORY;
            case SHIPYARD.name:
                return SHIPYARD;
            case SPACE_DOCK.name:
                return SPACE_DOCK;
            case MISSILE_SILO.name:
                return MISSILE_SILO;
            case RESEARCH_LAB.name:
                return RESEARCH_LAB;
            case ALLIANCE_DEPOT.name:
                return ALLIANCE_DEPOT;
            case TERRAFORMER.name:
                return TERRAFORMER;
            case LUNAR_BASE.name:
                return LUNAR_BASE;
            case SENSOR_PHALANX.name:
                return SENSOR_PHALANX;
            case JUMP_GATE.name:
                return JUMP_GATE;
            default:
                throw `Could not find a Building named ${buildingName}`
        }
    }
}

class Storage extends Building {

    constructor(id, name) {
        super(id, name);
    }

    /**
     * @returns {number}
     */
    maximum(level) {
        return 5000 * Math.floor(2.5 * Math.pow(Math.E, 20 * level / 33));
    }
}

class MetalMine extends Building {

    constructor() {
        super(1, 'Metal Mine');
    }

    hourlyProduction(level, plasmaTechnologyLevel) {
        const universeSpeed = SpyHelper.universeProperties.speed;
        return Math.floor(30 * level * Math.pow(1.1, level) * (1 + 0.01 * plasmaTechnologyLevel / 100) * universeSpeed) + 30 * universeSpeed;
    }
}

class CrystalMine extends Building {

    constructor() {
        super(2, 'Crystal Mine');
    }

    hourlyProduction(level, plasmaTechnologyLevel) {
        const universeSpeed = SpyHelper.universeProperties.speed;
        return Math.floor(20 * level * Math.pow(1.1, level) * (1 + 2 * plasmaTechnologyLevel / 300) * universeSpeed) + 15 * universeSpeed;
    }
}

class DeuteriumSynthesizer extends Building {

    constructor() {
        super(3, 'Deuterium Synthesizer');
    }

    hourlyProduction(level, planetPosition) {
        const universeSpeed = SpyHelper.universeProperties.speed;
        return (10 * level * 1.1 ^ level) * (1.36 - 0.004 * AVERAGE_TEMP[planetPosition]) * universeSpeed;
    }
}

class Research extends Entity {
    constructor(id, name) {
        super(id, name, 0, 0, 0);
    }
    static fromName(researchName) {
        switch (researchName) {
            case ENERGY_TECHNOLOGY.name:
                return ENERGY_TECHNOLOGY;
            case LASER_TECHNOLOGY.name:
                return LASER_TECHNOLOGY;
            case ION_TECHNOLOGY.name:
                return ION_TECHNOLOGY;
            case HYPERSPACE_TECHNOLOGY.name:
                return HYPERSPACE_TECHNOLOGY;
            case PLASMA_TECHNOLOGY.name:
                return PLASMA_TECHNOLOGY;
            case ESPIONAGE_TECHNOLOGY.name:
                return ESPIONAGE_TECHNOLOGY;
            case COMPUTER_TECHNOLOGY.name:
                return COMPUTER_TECHNOLOGY;
            case ASTROPHYSICS.name:
                return ASTROPHYSICS;
            case INTERGALACTIC_RESEARCH_NETWORK.name:
                return INTERGALACTIC_RESEARCH_NETWORK;
            case GRAVITON_TECHNOLOGY.name:
                return GRAVITON_TECHNOLOGY;
            case COMBUSTION_DRIVE.name:
                return COMBUSTION_DRIVE;
            case IMPULSE_DRIVE.name:
                return IMPULSE_DRIVE;
            case HYPERSPACE_DRIVE.name:
                return HYPERSPACE_DRIVE;
            case WEAPONS_TECHNOLOGY.name:
                return WEAPONS_TECHNOLOGY;
            case SHIELDING_TECHNOLOGY.name:
                return SHIELDING_TECHNOLOGY;
            case ARMOUR_TECHNOLOGY.name:
                return ARMOUR_TECHNOLOGY;
            default:
                throw `Could not find a Research named ${researchName}`
        }
    }
}

class Class {
    #name;
    #productionMultiplier;
    #color;

    constructor(name, productionMultiplier, color) {
        this.#name = name;
        this.#productionMultiplier = productionMultiplier;
        this.#color = color;
    }

    get name() {
        return this.#name;
    }

    get color() {
        return this.#color;
    }

    get productionMultiplier() {
        return this.#productionMultiplier;
    }

    static fromName(className) {
        switch (className) {
            case GENERAL.name:
                return GENERAL;
            case COLLECTOR.name:
                return COLLECTOR;
            case DISCOVERER.name:
                return DISCOVERER;
            case NO_CLASS.name:
                return NO_CLASS;
            default:
                throw `Could not find a Class named ${className}`
        }
    }
}

//region Combat Ships
const LIGHT_FIGHTER = new Ship(204, 'Light Fighter', 3000, 1000, 0, 50);
const HEAVY_FIGHTER = new Ship(205, 'Heavy Fighter', 6000, 4000, 0, 100);
const CRUISER = new Ship(206, 'Cruiser', 20000, 7000, 2000, 800);
const BATTLESHIP = new Ship(207, 'Battleship', 45000, 15000, 0, 1500);
const BATTLECRUISER = new Ship(215, 'Battlecruiser', 30000, 40000, 15000, 750);
const BOMBER = new Ship(211, 'Bomber', 50000, 25000, 15000, 500);
const DESTROYER = new Ship(213, 'Destroyer', 60000, 50000, 15000, 2000);
const DEATHSTAR = new Ship(214, 'Deathstar', 5e6, 4e6, 1e6, 1e6);
const REAPER = new Ship(218, 'Reaper', 85000, 55000, 20000, 10000);
const PATHFINDER = new Ship(219, 'Pathfinder', 8000, 15000, 8000, 10000);
//endregion
//region Civil Ships
const SMALL_CARGO = new Ship(202, 'Small Cargo', 2000, 2000, 0, 5000);
const LARGE_CARGO = new Ship(203, 'Large Cargo', 6000, 6000, 0, 25000);
const COLONY_SHIP = new Ship(208, 'Colony Ship', 10000, 20000, 10000, 7500);
const RECYCLER = new Ship(209, 'Recycler', 10000, 6000, 2000, 20000);
const ESPIONAGE_PROBE = new Ship(210, 'Espionage Probe', 0, 1000, 0, 0);
const SOLAR_SATELLITE = new Ship(212, 'Solar Satellite', 0, 2000, 500, 0);
const CRAWLER = new Ship(217, 'Crawler', 2000, 2000, 1000);
//endregion
//region Defences
const ROCKET_LAUNCHER = new Defence(401, 'Rocket Launcher', 2000, 0, 0, 2000, 20, 80);
const LIGHT_LASER = new Defence(402, 'Light Laser', 1500, 500, 0, 2000, 25, 100);
const HEAVY_LASER = new Defence(403, 'Heavy Laser', 6000, 2000, 0, 8000, 100, 250);
const GAUSS_CANNON = new Defence(404, 'Gauss Cannon', 20000, 15000, 2000, 35000, 200, 1100);
const ION_CANNON = new Defence(405, 'Ion Cannon', 2000, 6000, 0, 8000, 500, 150);
const PLASMA_TURRET = new Defence(406, 'Plasma Turret', 50000, 50000, 15000, 100000, 300, 3000);
const SMALL_SHIELD_DOME = new Defence(407, 'Small Shield Dome', 10000, 10000, 0, 20000, 2000, 1);
const LARGE_SHIELD_DOME = new Defence(408, 'Large Shield Dome', 50000, 50000, 0, 100000, 10000, 1);
//endregion
//region Missiles
const ANTI_BALLISTIC_MISSILES = new Missile(502, 'Anti-Ballistic Missiles', 8000, 0, 2000, 8000, 1, 1);
const INTERPLANETARY_MISSILES = new Missile(503, 'Interplanetary Missiles', 12500, 2500, 10000, 15000, 1, 12000);
//endregion
//region Buildings
const METAL_MINE = new MetalMine(1, 'Metal Mine');
const METAL_STORAGE = new Storage(22, 'Metal Storage');
const CRYSTAL_MINE = new CrystalMine(2, 'Crystal Mine');
const CRYSTAL_STORAGE = new Storage(23, 'Crystal Storage');
const DEUTERIUM_SYNTHESIZER = new DeuteriumSynthesizer(3, 'Deuterium Synthesizer');
const DEUTERIUM_TANK = new Storage(24, 'Deuterium Tank');
const SOLAR_PLANT = new Building(4, 'Solar Plant');
const FUSION_REACTOR = new Building(12, 'Fusion Reactor');
const ROBOTICS_FACTORY = new Building(14, 'Robotics Factory');
const NANITE_FACTORY = new Building(15, 'Nanite Factory');
const SHIPYARD = new Building(21, 'Shipyard');
const SPACE_DOCK = new Building(36, 'Space Dock');
const MISSILE_SILO = new Building(44, 'Missile Silo');
const RESEARCH_LAB = new Building(31, 'Research Lab');
const ALLIANCE_DEPOT = new Building(34, 'Alliance Depot');
const TERRAFORMER = new Building(33, 'Terraformer');
const LUNAR_BASE = new Building(41, 'Lunar Base');
const SENSOR_PHALANX = new Building(42, 'Sensor Phalanx');
const JUMP_GATE = new Building(43, 'Jump Gate');
//endregion
//region Researches
const ENERGY_TECHNOLOGY = new Research(113, "Energy Technology");
const LASER_TECHNOLOGY = new Research(120, "Laser Technology");
const ION_TECHNOLOGY = new Research(121, "Ion Technology");
const HYPERSPACE_TECHNOLOGY = new Research(114, "Hyperspace Technology");
const PLASMA_TECHNOLOGY = new Research(122, "Plasma Technology");
const ESPIONAGE_TECHNOLOGY = new Research(106, "Espionage Technology");
const COMPUTER_TECHNOLOGY = new Research(108, "Computer Technology");
const ASTROPHYSICS = new Research(124, "Astrophysics");
const INTERGALACTIC_RESEARCH_NETWORK = new Research(123, "Research Network");
const GRAVITON_TECHNOLOGY = new Research(199, "Graviton Technology");
const COMBUSTION_DRIVE = new Research(115, "Combustion Drive");
const IMPULSE_DRIVE = new Research(117, "Impulse Drive");
const HYPERSPACE_DRIVE = new Research(118, "Hyperspace Drive");
const WEAPONS_TECHNOLOGY = new Research(109, "Weapons Technology");
const SHIELDING_TECHNOLOGY = new Research(110, "Shielding Technology");
const ARMOUR_TECHNOLOGY = new Research(111, "Armour Technology");
//endregion
//region Classes
const COLLECTOR = new Class("Collector", 1.25, "orange");
const GENERAL = new Class("General", 1, "red");
const DISCOVERER = new Class("Discoverer", 1, "blue");
const NO_CLASS = new Class("No class selected", 1, "");
//endregion

class UniverseProperties {
    constructor(speed, fleetSpeed, debrisRatio, debrisRatioDefense) {
        this._speed = speed;
        this._fleetSpeed = fleetSpeed;
        this._debrisRatio = debrisRatio;
        this._debrisRatioDefense = debrisRatioDefense;
    }

    get speed() {
        return this._speed;
    }

    get fleetSpeed() {
        return this._fleetSpeed;
    }

    get debrisRatio() {
        return this._debrisRatio;
    }

    get debrisRatioDefence() {
        return this._debrisRatioDefense;
    }

    /**
     * @param universe
     * @returns {Promise<null>}
     */
    static get(universe) {
        const link = `https://${universe}/api/serverData.xml`;
        return Promise.resolve($.get(link, result => {
            SpyHelper.universeProperties = new UniverseProperties(
                parseFloat($(result).find('speed').get(0).textContent),
                parseFloat($(result).find('speedFleet').get(0).textContent),
                parseFloat($(result).find('debrisFactor').get(0).textContent),
                parseFloat($(result).find('debrisFactorDef').get(0).textContent),
            );
        }));
    }
}


class Coordinates extends Serializable {
    #galaxy;
    #system;
    #position;
    #type;

    constructor(galaxy, system, position, type) {
        super();
        this.#galaxy = galaxy;
        this.#system = system;
        this.#position = position;
        this.#type = type;
    }

    get galaxy() {
        return this.#galaxy;
    }

    get system() {
        return this.#system;
    }

    get position() {
        return this.#position;
    }

    get type() {
        return this.#type;
    }

    print() {
        return `${this.galaxy}:${this.system}:${this.position}:${this.type}`
    }

    hashCode() {
        return this.print();
    }

    /*static fromString(string) {
        const match = /(\d):(\d+):(\d+):(\d)/g.exec(string);
        return new Coordinates(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4]));
    }*/

    /**
     * Extracts coordinates from text in the format galaxy:system:planet
     * @param text text with the coordinates
     * @param type {Number} Type of of celestial body, PLANET, MOON or DEBRIS
     * @returns {Coordinates}
     */
    static fromText(text, type) {
        const match = /(\d):(\d+):(\d+)/g.exec(text);
        return new Coordinates(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), type);
    }

    /**
     * @param report
     * @returns {Coordinates}
     */
    static fromReport(report) {
        let attackLink;
        let match;
        try {
            attackLink = $(report).find('.icon_attack').get(0).parentNode.href;
            match = /galaxy=(\d+)&system=(\d+)&position=(\d+)&type=(\d+)/g.exec(attackLink);
            return new Coordinates(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4]));
        } catch (e) {
            //We are probably in a expedition or event report thingy.
            attackLink = $(report).find('.msg_title.blue_txt').text();
            return Coordinates.fromText(attackLink, PLANET);
        }

    }

    equals(other) {
        return this.galaxy === other.galaxy && this._system === other._system && this._position === other._position && this._type === other._type
    }

    withType(type) {
        if (this.type === type) {
            return this;
        } else {
            return new Coordinates(this.galaxy, this.system, this.position, type);
        }
    }

    moonCoordinates() {
        return this.withType(MOON);
    }

    planetCoordinates() {
        return this.withType(PLANET);
    }

    toJson() {
        return {
            galaxy: this.galaxy,
            system: this.system,
            position: this.position,
            type: this.type
        }
    }

    static fromJson(json) {
        if (json === null) {
            return new Coordinates();
        } else {
            return new Coordinates(json.galaxy, json.system, json.position, json.type);
        }
    }
}

class Section {
    #seen;

    constructor(seen) {
        this.#seen = seen;
    }

    get seen() {
        return this.#seen;
    }

    static sectionFromReport(report, sectionID, type, section, reportDate) {
        const things = SpyHelper.getArrayDetails(report, sectionID);
        if (things.seen) {
            let thingMap = new BetterMap();
            for (let name in things) {
                if (things.hasOwnProperty(name)) {
                    const amount = things[name];
                    if (Number.isInteger(amount) && amount >= 0) {
                        const thingType = type.fromName(name);
                        thingMap.set(thingType, amount)
                    }
                }
            }

            return new section(thingMap, reportDate);
        } else {
            return NotSeenSection.instance;
        }
    }

    static as(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.fromJson(json);
            case Resources.name:
                return Resources.fromJson(json);
            case Debris.name:
                return Debris.fromJson(json);
            case Fleets.name:
                return Fleets.fromJson(json);
            case Defences.name:
                return Defences.fromJson(json);
            case Buildings.name:
                return Buildings.fromJson(json);
            case Researches.name:
                return Researches.fromJson(json);
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }
}

class NotSeenSection extends Section {
    constructor() {
        super(false);
    }

    toJson() {
        return { type: this.constructor.name };
    }

    static get instance() {
        return new NotSeenSection();
    }

    get date() {
        throw "No date for NotSeenSection";
    }
}

class VisibleSection extends Section {
    /**
     * @type {BetterMap<Entity, Number>}
     */
    #all;
    #date;

    constructor(all, date) {
        super(true);
        this.#all = all;
        this.#date = date;
    }

    get all() {
        return this.#all;
    }

    get date() {
        return this.#date;
    }

    get tooltipText() {
        return this.all.fold("", (acc, entity, amount) => `${acc}${entity.name}: ${amount}<br />`)

    }

    amountOf(what) {
        return this.all.getOrElse(what, 0);
    }

    levelOf(what) {
        return this.amountOf(what);
    }

    static visibleSectionFromJSON(json, type, section) {
        let thingMap = new BetterMap();
        for (let name in json) {
            if (json.hasOwnProperty(name)) {
                const amount = json[name];
                if (Number.isInteger(amount) && amount > 0) {
                    const thingType = type.fromName(name);
                    thingMap.set(thingType, amount)
                }
            }
        }

        return new section(thingMap, new Date(json.date));
    }

    toJson() {
        return this.all.fold({ type: this.constructor.name, date: this.#date }, (acc, thing, amount) => {
            acc[thing.name] = amount;
            return acc;
        })
    }
}

class Resources extends VisibleSection {
    /**
     *
     * @param metal {number}
     * @param crystal {number}
     * @param deuterium {number}
     * @param energy {number}
     * @param plunderRatio {number}
     * @param date {Date}
     */
    constructor(metal, crystal, deuterium, energy, plunderRatio, date = new Date()) {
        //super(undefined, date);
        super(undefined, date);
        this._metal = metal;
        this._crystal = crystal;
        this._deuterium = deuterium;
        this._energy = energy;
        this._plunderRatio = plunderRatio;
    }

    get metal() {
        return this._metal;
    }

    get crystal() {
        return this._crystal;
    }

    get deuterium() {
        return this._deuterium;
    }

    get energy() {
        return this._energy;
    }

    get plunderRatio() {
        return this._plunderRatio;
    }

    get total() {
        return this.metal + this.crystal + this.deuterium;
    }

    get metalPlunder() {
        return this.metal * this.plunderRatio;
    }

    get crystalPlunder() {
        return this.crystal * this.plunderRatio;
    }

    get deuteriumPlunder() {
        return this.deuterium * this.plunderRatio;
    }

    get totalPlunder() {
        return this.total * this.plunderRatio;
    }

    static fromDetailedReport(report, details) {
        const resources = $(details.find(`[data-type="resources"]`).get(0))
            .find('.resource_list_el')
            .toArray()
            .reduce((acc, element, id) => {
                acc[id] = SpyHelper.parseTextNumber(element.title);
                return acc
            }, {});

        const plunderRatioText = $($(report).find('.compacting').get(3)).find('.ctn').get(0).innerHTML;
        const plunderRatio = SpyHelper.parseTextNumber(plunderRatioText) / 100;

        return new Resources(
            resources[0],
            resources[1],
            resources[2],
            resources[3],
            plunderRatio
        );
    }

    toJson() {
        return { type: this.constructor.name, ...this};
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Resources.name:
                return new Resources(
                    json._metal,
                    json._crystal,
                    json._deuterium,
                    json._energy,
                    json._plunderRatio
                );
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }

    print() {
        return `metal: ${this.metal}, crystal: ${this.crystal}, deuterium: ${this.deuterium}, plunderRatio: ${this.plunderRatio}`
    }
}

class Debris extends VisibleSection {
    /**
     *
     * @param metal {number}
     * @param crystal {number}
     * @param date {Date}
     */
    constructor(metal, crystal, date = new Date()) {
        super(undefined, date);
        this._metal = metal;
        this._crystal = crystal;
    }

    get metal() {
        return this._metal;
    }

    get crystal() {
        return this._crystal;
    }

    get total() {
        return this._metal + this._crystal
    }

    /**
     * Sums two debris
     * @param debris {Debris}
     * @returns {Debris}
     */
    add(debris) {
        return new Debris(this.metal + debris.metal, this.crystal + debris.crystal)
    }

    static fromDetailedReport(details) {
        const resourceSections = details.find(`[data-type="resources"]`);
        if (resourceSections.length === 2) {
            const resources = $(resourceSections.get(1))
                .find('.resource_list_el')
                .toArray()
                .reduce((acc, element, id) => {
                    acc[id] = SpyHelper.parseTextNumber(element.title);
                    return acc
                }, {});

            return new Debris(
                resources[0],
                resources[1]
            )
        } else {
            return NotSeenSection.instance;
        }
    }

    toJson() {
        return { type: this.constructor.name, ...this};
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Debris.name:
                return new Debris(
                    json._metal,
                    json._crystal,
                );
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }

    /**
     * Calculates the debris of destroy the given entities using the given debrisFactor
     * @param entities {BetterMap<Entity, Number>}
     * @param debrisFactor {Number}
     */
    static calculateFor(entities, debrisFactor) {
        return entities.fold(new Debris(0, 0), (totalDebris, entity, amount) => {
            const debrisAmount = debrisFactor * amount;
            return totalDebris.add(new Debris(debrisAmount * entity.metalCost, debrisAmount * entity.crystalCost));
        });
    }
}

class Fleets extends VisibleSection {
    /**
     * @param ships {BetterMap<Ship, Number>}
     * @param date {Date}
     */
    constructor(ships, date = new Date()) {
        super(ships, date);
    }

    static fromDetailedReport(report, reportDate) {
        return Section.sectionFromReport(report, FLEET_SECTION, Ship, Fleets, reportDate);
    }

    get debris() {
        return Debris.calculateFor(this.all, SpyHelper.universeProperties.debrisRatio);
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Fleets.name:
                return VisibleSection.visibleSectionFromJSON(json, Ship, Fleets);
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }
}

class Defences extends VisibleSection {
    /**
     * @param defences {BetterMap<Defence, Number>}
     * @param date {Date}
     */
    constructor(defences, date = new Date()) {
        super(defences, date);
    }

    static fromDetailedReport(report, reportDate) {
        return Section.sectionFromReport(report, DEFENCES_SECTION, Defence, Defences, reportDate);
    }

    get noMissiles() {
        return this.all.filterKeys(defence => !(defence instanceof Missile))
    }

    get debris() {
        return Debris.calculateFor(this.noMissiles, SpyHelper.universeProperties.debrisRatioDefence);
    }

    get score() {
        return this.all
            .fold(0, (acc, defense, amount) => {
                return acc + defense.defenceScore * amount;
            })
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Defences.name:
                return VisibleSection.visibleSectionFromJSON(json, Defence, Defences);
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }
}

class Buildings extends VisibleSection {
    /**
     * @param buildings {BetterMap<Building, Number>}
     * @param date {Date}
     */
    constructor(buildings, date = new Date()) {
        super(buildings, date);
    }

    static fromDetailedReport(report, reportDate) {
        return Section.sectionFromReport(report, BUILDINGS_SECTION, Building, Buildings, reportDate);
    }

    /**
     *
     * @param planetResources {Resources | NotSeenSection}
     * @param reportDate {Date}
     * @param researches {Researches | NotSeenSection}
     * @param coordinates {Coordinates}
     * @param clazz {Class}
     * @returns {Resources}
     */
    production(planetResources, reportDate, researches, coordinates, clazz) {
        if (coordinates.type !== PLANET) {
            return new Resources(0, 0, 0, 0, planetResources.plunderRatio);
        }
        let plasmaTechnologyLevel = 0;
        if (researches.seen) {
            plasmaTechnologyLevel = researches.levelOf(PLASMA_TECHNOLOGY)
        }
        const maxMetal = METAL_STORAGE.maximum(this.levelOf(METAL_STORAGE));
        const metalProduction = METAL_MINE.hourlyProduction(this.levelOf(METAL_MINE), plasmaTechnologyLevel) * clazz.productionMultiplier;

        const maxCrystal = CRYSTAL_STORAGE.maximum(this.levelOf(CRYSTAL_STORAGE));
        const crystalProduction = CRYSTAL_MINE.hourlyProduction(this.levelOf(CRYSTAL_MINE), plasmaTechnologyLevel) * clazz.productionMultiplier;

        const maxDeuterium = DEUTERIUM_TANK.maximum(this.levelOf(DEUTERIUM_TANK));
        const deuteriumProduction = DEUTERIUM_SYNTHESIZER.hourlyProduction(this.levelOf(DEUTERIUM_SYNTHESIZER), coordinates.position) * clazz.productionMultiplier;

        const deltaHours = (Date.now() - reportDate) / 3.6e6;

        const totalMetal = Math.max(Math.min(maxMetal - planetResources.metal, metalProduction * deltaHours), 0);
        const totalCrystal = Math.max(Math.min(maxCrystal - planetResources.crystal, crystalProduction * deltaHours), 0);
        const totalDeuterium = Math.max(Math.min(maxDeuterium - planetResources.deuterium, deuteriumProduction * deltaHours), 0);
        return new Resources(totalMetal, totalCrystal, totalDeuterium, 0, planetResources.plunderRatio);
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Buildings.name:
                return VisibleSection.visibleSectionFromJSON(json, Building, Buildings);
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }
}

class Researches extends VisibleSection {
    /**
     * @param researches {BetterMap<Research, Number>}
     * @param date {Date}
     */
    constructor(researches = new BetterMap(), date = new Date()) {
        super(researches, date);
    }

    static fromDetailedReport(report, reportDate) {
        return Section.sectionFromReport(report, RESEARCHES_SECTION, Research, Researches, reportDate);
    }

    static fromJson(json) {
        switch (json.type) {
            case NotSeenSection.name:
                return NotSeenSection.instance;
            case Researches.name:
                return VisibleSection.visibleSectionFromJSON(json, Research, Researches);
            default:
                throw `Could not parse json of type: ${json.type}`;
        }
    }
}


class SavedInLocalStorage extends Serializable {
    static get saveName() {
        throw `saveName not implement for ${this.name}`
    }

    static load(What) {
        console.log(`Loading ${What.name}`);
        try {
            return What.fromJson(JSON.parse(localStorage.getItem(What.saveName)));
        } catch (e) {
            console.error(`Could not load ${What.name}!`);
            console.error(e);
            return new What(); //Create a new instance of this
        }
    }

    save(What) {
        const value = JSON.stringify(this.toJson());
        console.log(value)
        try {
            localStorage.setItem(What.saveName, value);
        } catch (e) {
            console.error(e)
        }
    }
}

class Player extends Serializable {
    #id;
    #name;
    #planets;
    #researches;

    constructor(id, name, planets = [], researches = NotSeenSection.instance) {
        super();
        this.#id = id;
        this.#name = name;
        this.#planets = planets;
        this.#researches = researches;
    }

    get id() {
        return this.#id;
    }

    get name() {
        return this.#name;
    }

    get planets() {
        return this.#planets;
    }

    get researches() {
        return this.#researches;
    }

    copy({
             id = this.id,
             name = this.name,
             planets = this.planets,
             researches = this.researches
         } = {}) {
        return new Player(id, name, planets, researches);
    }

    toJson() {
        return {
            id: this.id,
            name: this.name,
            planets: this.planets.map(planet => planet.toJson()),
            researches: this.researches.toJson()
        }
    }

    static fromJson(json) {
        if (json === null) {
            throw "Could not load Player from JSON, JSON was null"
        } else {
            const planets = json.planets.map(planetJson => Planet.fromJson(planetJson));
            const researches = Researches.fromJson(json.researches);
            return new Player(parseInt(json.id), json.name, planets, researches);
        }
    }
}

class CelestialBody extends Serializable {
    #id;
    #coordinates;
    #buildings;
    #defences;

    /**
     * @param id {Number}
     * @param coordinates {Coordinates}
     * @param buildings {Buildings | NotSeenSection}
     * @param defences {Defences | NotSeenSection}
     */
    constructor(id, coordinates, buildings, defences) {
        super();
        this.#id = id;
        this.#coordinates = coordinates;
        this.#buildings = buildings;
        this.#defences = defences;
    }

    get id() {
        return this.#id;
    }

    get coordinates() {
        return this.#coordinates;
    }

    get buildings() {
        return this.#buildings;
    }

    get defences() {
        return this.#defences;
    }
}

class Moon extends CelestialBody {
    #size;

    /**
     * @param id {Number}
     * @param coordinates {Coordinates}
     * @param buildings {Buildings | NotSeenSection}
     * @param defences {Defences | NotSeenSection}
     * @param size {Number}
     */
    constructor(id, coordinates, buildings, defences, size) {
        super(id, coordinates, buildings, defences);
        this.#size = size;
    }

    get size() {
        return this.#size;
    }

    copy({
             id = this.id,
             coordinates = this.coordinates,
             buildings = this.buildings,
             defences = this.defences,
             size = this.size
         } = {}) {
        return new Moon(id, coordinates, buildings, defences, size);
    }

    toJson() {
        return {
            id: this.id,
            coordinates: this.coordinates.toJson(),
            buildings: this.buildings.toJson(),
            defences: this.defences.toJson(),
            size: this.size
        }
    }

    static fromJson(json) {
        if (json === null) {
            throw "Could not load Moon from JSON, JSON was null"
        } else {
            const coordinates = Coordinates.fromJson(json.coordinates);
            const buildings = Buildings.fromJson(json.buildings);
            const defences = Defences.fromJson(json.defences);
            const id = parseInt(json.id) || undefined;
            const size = parseInt(json.size) || undefined;
            return new Moon(id, coordinates, buildings, defences, size);
        }
    }
}

class Planet extends CelestialBody {
    #moonId;

    /**
     * @param id {Number}
     * @param coordinates {Coordinates}
     * @param buildings {Buildings | NotSeenSection}
     * @param defences {Defences | NotSeenSection}
     * @param moonId {Number | undefined}
     */
    constructor(id, coordinates, buildings, defences, moonId = undefined) {
        super(id, coordinates, buildings, defences);
        this.#moonId = moonId;
    }

    /**
     * @returns {Number | undefined}
     */
    get moonId() {
        return this.#moonId;
    }

    copy({
             id = this.id,
             coordinates = this.coordinates,
             buildings = this.buildings,
             defences = this.defences,
             moonId = this.moonId
         } = {}) {
        return new Planet(id, coordinates, buildings, defences, moonId);
    }

    toJson() {
        return {
            id: this.id,
            coordinates: this.coordinates.toJson(),
            buildings: this.buildings.toJson(),
            defences: this.defences.toJson(),
            moonId: this.moonId
        }
    }

    static fromJson(json) {
        if (json === null) {
            throw "Could not load Planet from JSON, JSON was null"
        } else {
            const coordinates = Coordinates.fromJson(json.coordinates);
            const buildings = Buildings.fromJson(json.buildings);
            const defences = Defences.fromJson(json.defences);
            const moonId = parseInt(json.moonId) || undefined;
            return new Planet(parseInt(json.id), coordinates, buildings, defences, moonId);
        }
    }
}

function daysSince(date) {
    return (NOW - date) / (24 * 60 * 60 * 1000);
}

class Universe extends SavedInLocalStorage {
    #playersAPIDate;
    #universeAPIDate;
    /**
     * @type {BetterMap<Number, Player>}
     */
    #players;
    /**
     * @type {HashCodeMap<Coordinates, Planet>}
     */
    #planets;
    /**
     * @type {HashCodeMap<Coordinates, Moon>}
     */
    #moons;

    constructor(playersAPIDate = new Date(0), universeAPIDate = new Date(0), players = new BetterMap(), planets = new HashCodeMap(), moons = new HashCodeMap()) {
        super();
        this.#playersAPIDate = playersAPIDate;
        this.#universeAPIDate = universeAPIDate;
        this.#players = players;
        this.#planets = planets;
        this.#moons = moons;
    }

    /**
     *
     * @param name
     * @returns {Player | undefined}
     */
    findPlayerByName(name) {
        return Array.from(this.#players.values()).find(player => player.name === name)
    }

    /**
     * Looks for a planet with the given ID
     * @param id {Number}
     * @returns {Planet | undefined}
     */
    findPlanetByID(id) {
        return Array.from(this.#planets.values()).find(planet => planet.id === id)
    }

    findPlanetByCoordinates(coordinates) {
        return this.#planets.get(coordinates)
    }

    findMoonByCoordinates(coordinates) {
        return this.#moons.get(coordinates)
    }

    addPlanetToPlayer(planet, playerID) {
        const player = this.#players.get(playerID);
        if (player === undefined) {
            //throw `Could not find player with ID: ${playerID}`
        } else {
            if (player.planets.every(existingPlanet => existingPlanet.id !== planet.id)) {
                this.#players.set(playerID, player.copy({
                    planets: player.planets.concat(planet)
                }))
            }
        }
    }

    /**
     * Looks for a moon with the given ID
     * @param id {Number}
     * @returns {Moon | undefined}
     */
    findMoonByID(id) {
        return Array.from(this.#moons.values()).find(moon => moon.id === id)
    }

    updatePlayerWithId(id, name) {
        const player = this.#players.get(id);
        if (player === undefined) {
            this.#players.set(id, new Player(id, name, [], NotSeenSection.instance))
        } else {
            this.#players.set(id, player.copy({
                name: player.name || name
            }))
        }
        return this.#players.get(id);
    }

    moveMoon(moon, targetCoordinates) {
        this.#moons.delete(moon.coordinates);
        this.#moons.set(targetCoordinates, moon);
        return moon;
    }

    /**
     * Moves a planet and its moon to the given coordinates.
     * @param planet {Planet}
     * @param targetCoordinates {Coordinates}
     * @return {Planet}
     */
    movePlanet(planet, targetCoordinates) {
        this.#planets.delete(planet.coordinates);
        this.#planets.set(targetCoordinates, planet);
        if (planet.moonId !== undefined) {
            const moonId = planet.moonId;
            const moonById = this.findMoonByID(moonId);
            this.moveMoon(moonById, targetCoordinates.moonCoordinates())
        }
        return planet;
    }

    /**
     * @param id {Number}
     * @param coordinates {Coordinates}
     * @param moon {Moon | undefined}
     * @returns {*}
     */
    updatePlanetWithId(id, coordinates, moon) {
        let planet = this.findPlanetByID(id);
        const planetByCoordinates = this.#planets.get(coordinates);
        if (planet === undefined && planetByCoordinates !== undefined) {
            if (planetByCoordinates.id !== undefined && planetByCoordinates.id !== id) {
                //Conflicting IDs
                console.error(`Updating existing planet with id ${planetByCoordinates.id} but using ${id}`);
            }
            //Planet was added without ID, update it.
            this.#planets.set(coordinates, planetByCoordinates.copy({
                id: id
            }));
        } else if (planet === undefined) {
            //This is a new planet we don't have stored
            console.log(`Found new planet at ${coordinates.print()} with id: ${id}`);
            this.#planets.set(coordinates, new Planet(id, coordinates, NotSeenSection.instance, NotSeenSection.instance));
        } else {
            if (planetByCoordinates === undefined) {
                //Planet moved
                planet = this.movePlanet(planet, coordinates);
            }
            if (moon !== undefined) {
                planet = planet.copy({
                    moonId: moon.id
                })
            }
            this.#planets.set(coordinates, planet)
        }
        return this.#planets.get(coordinates);
    }

    /**
     * @param id {Number}
     * @param coordinates {Coordinates}
     * @param size {Number | undefined}
     * @returns {Moon}
     */
    updateMoonWithId(id, coordinates, size) {
        const moon = this.findMoonByID(id);
        if (moon === undefined) {
            this.#moons.set(coordinates, new Moon(id, coordinates, NotSeenSection.instance, NotSeenSection.instance, size));
        } else {
            this.#moons.set(coordinates, moon.copy({
                coordinates: coordinates,
                size: moon.size || size
            }));
        }
        return this.#moons.get(coordinates);
    }

    /**
     * @param coordinates {Coordinates}
     * @param buildings {Buildings | NotSeenSection}
     * @param defences {Defences | NotSeenSection}
     * @returns {Planet}
     */
    updatePlanetAt(coordinates, buildings, defences) {
        const planet = this.#planets.get(coordinates);
        if (planet === undefined) {
            this.#planets.set(coordinates, new Planet(null, coordinates, buildings, defences))
        } else {
            let updatedBuildings = planet.buildings;
            if (buildings.seen &&  (!planet.buildings.seen || buildings.date > planet.buildings.date)) {
                updatedBuildings = buildings;
            }
            let updatedDefences = planet.defences;
            if (defences.seen &&  (!planet.defences.seen || defences.date > planet.defences.date)) {
                updatedDefences = defences;
            }

            this.#planets.set(coordinates, planet.copy({
                buildings: updatedBuildings,
                defences: updatedDefences,
            }));
        }
        return this.#planets.get(coordinates);
    }

    /**
     *
     * @param coordinates {Coordinates}
     * @param buildings {Buildings | NotSeenSection}
     * @param defences {Defences | NotSeenSection}
     * @returns {Moon}
     */
    updateMoonAt(coordinates, buildings, defences) {
        const moon = this.#moons.get(coordinates);
        if (moon === undefined) {
            this.#moons.set(coordinates, new Moon(undefined, coordinates, buildings, defences, undefined));
        } else {
            let updatedBuildings = moon.buildings;
            if (buildings.seen &&  (!moon.buildings.seen || buildings.date > moon.buildings.date)) {
                updatedBuildings = buildings;
            }
            let updatedDefences = moon.defences;
            if (defences.seen &&  (!moon.defences.seen || defences.date > moon.defences.date)) {
                updatedDefences = defences;
            }

            this.#moons.set(coordinates, moon.copy({
                buildings: updatedBuildings,
                defences: updatedDefences,
            }));
        }
        return this.#moons.get(coordinates);
    }

    /**
     *
     * @param name {String}
     * @param researches {Researches | NotSeenSection}
     * @returns {Player | undefined}
     */
    updatePlayerNamed(name, researches) {
        const player = this.findPlayerByName(name);
        if (player !== undefined) {
            let updatedResearches = player.researches;
            if (researches.seen && (!player.researches.seen || researches.date > player.researches.date)) {
                console.log(`Updating researches for ${name}`);
                console.log(player.researches);
                console.log(researches);
                updatedResearches = researches;
            }
            this.#players.set(player.id, player.copy({
                researches: updatedResearches
            }))
        }
        return this.findPlayerByName(name);
    }

    updateMoon(planet, coordinates) {
        const moon = planet.children[0];
        if (moon !== undefined) {
            const moon$ = $(moon);
            const id = parseInt(moon.id);
            const size = parseInt(moon$.attr("size"));
            return this.updateMoonWithId(id, coordinates, size);
        } else {
            return undefined;
        }
    }

    /**
     * @param universe
     * @returns {Promise<null>}
     */
    updatePlanetsAndMoons(universe) {
        if (daysSince(this.#universeAPIDate) > 7) {
            const link = `https://${universe}/api/universe.xml`;
            return Promise.resolve($.get(link, result => {
                const universe = $(result).find("universe");
                universe.find("planet").toArray().forEach(planet => {
                    const planet$ = $(planet);
                    const coordinates = Coordinates.fromText(planet$.attr("coords"), PLANET);
                    const moon = this.updateMoon(planet, coordinates.moonCoordinates());
                    const id = parseInt(planet.id);
                    const updatedPlanet = this.updatePlanetWithId(id, coordinates, moon);
                    const playerID = parseInt(planet$.attr("player"));
                    this.addPlanetToPlayer(updatedPlanet, playerID);
                });
                this.#universeAPIDate = new Date(parseInt(universe.attr("timestamp")) * 1000);
            }));
        } else {
            return Promise.resolve(null);
        }
    }

    /**
     * @param universe
     * @returns {Promise<null>}
     */
    updatePlayers(universe) {
        if (daysSince(this.#playersAPIDate) > 1) {
            const link = `https://${universe}/api/players.xml`;
            return Promise.resolve($.get(link, result => {
                const players = $(result).find("players");
                players.find("player").toArray().map(player => {
                    const id = parseInt(player.id);
                    const name = $(player).attr("name");
                    this.updatePlayerWithId(id, name);
                });
                this.#playersAPIDate = new Date(parseInt(players.attr("timestamp")) * 1000);
            }));
        } else {
            return Promise.resolve(null);
        }
    }

    /**
     * @param universe
     * @returns {Promise<void>}
     */
    updateEverything(universe) {
        const updatePlayers = this.updatePlayers(universe);
        const updatePlanetsAndMoons = this.updatePlanetsAndMoons(universe);
        return Promise.all([updatePlayers, updatePlanetsAndMoons]).then(() => this.saveToLocalStorage());
    }

    static get saveName() {
        return `${SCRIPT_NAME}_${UNIVERSE}_universe`;
    }

    toJson() {
        return {
            playersAPIDate: this.#playersAPIDate,
            universeAPIDate: this.#universeAPIDate,
            players: Array.from(this.#players.values()).map(player => player.toJson()),
            planets: Array.from(this.#planets.values()).map(planet => planet.toJson()),
            moons: Array.from(this.#moons.values()).map(moon => moon.toJson())
        }
    }

    static fromJson(json) {
        if (json === null) {
            return new Universe();
        } else {
            const playersAPIDate = json.playersAPIDate;
            const universeAPIDate = json.universeAPIDate;
            const players = json.players.reduce((acc, playerJson) => {
                const player = Player.fromJson(playerJson);
                acc.set(player.id, player);
                return acc;
            }, new BetterMap());
            const planets = json.planets.reduce((acc, planetJson) => {
                const planet = Planet.fromJson(planetJson);
                acc.set(planet.coordinates, planet);
                return acc;
            }, new HashCodeMap());
            const moons = json.moons.reduce((acc, moonJson) => {
                const moon = Moon.fromJson(moonJson);
                acc.set(moon.coordinates, moon);
                return acc;
            }, new HashCodeMap());
            return new Universe(playersAPIDate, universeAPIDate, players, planets, moons)
        }
    }

    static loadFromLocalStorage() {
        return this.load(Universe)
    }

    saveToLocalStorage() {
        this.save(Universe);
    }
}

class Details {
    resources;
    debris;
    fleet;
    defences;
    buildings;
    researches;

    constructor(resources, debris, fleet, defences, buildings, researches) {
        this.resources = resources;
        this.debris = debris;
        this.fleet = fleet;
        this.defences = defences;
        this.buildings = buildings;
        this.researches = researches;
    }

    static fromDetailedReport(report, reportDate, detailedReport) {
        const resources = Resources.fromDetailedReport(report, detailedReport);
        const debris = Debris.fromDetailedReport(detailedReport);
        const fleet = Fleets.fromDetailedReport(detailedReport, reportDate);
        const defences = Defences.fromDetailedReport(detailedReport, reportDate);
        const buildings = Buildings.fromDetailedReport(detailedReport, reportDate);
        const researches = Researches.fromDetailedReport(detailedReport, reportDate);
        return new Details(resources, debris, fleet, defences, buildings, researches)
    }

    toJson() {
        return {
            resources: this.resources.toJson(),
            debris: this.debris.toJson(),
            fleet: this.fleet.toJson(),
            defences: this.defences.toJson(),
            buildings: this.buildings.toJson(),
            researches: this.researches.toJson()
        }
    }

    static fromJson(json) {
        const resources = Resources.fromJson(json.resources);
        const debris = Debris.fromJson(json.debris);
        const fleet = Fleets.fromJson(json.fleet);
        const defences = Defences.fromJson(json.defences);
        const buildings = Buildings.fromJson(json.buildings);
        const researches = Researches.fromJson(json.researches);
        return new Details(resources, debris, fleet, defences, buildings, researches)
    }
}

class Message {
    id;
    report;
    date;

    constructor(id, report, date) {
        this.id = id;
        this.report = report;
        this.date = date;
    }
}

class Report extends Message {
    coordinates;
    resources;
    fleet;
    defense;
    total;
    totalWithProduction;

    /**
     * @param id {Number}
     * @param report
     * @param date {Date}
     * @param coordinates {Coordinates}
     * @param resources {Resources}
     * @param fleet {Fleets | NotSeenSection}
     * @param defense {Defences | NotSeenSection}
     * @param total {Number}
     * @param totalWithProduction {Number}
     */
    constructor(id, report, date, coordinates, resources, fleet, defense, total, totalWithProduction) {
        super(id, report, date);
        this.coordinates = coordinates;
        this.resources = resources;
        this.fleet = fleet;
        this.defense = defense;
        this.total = total;
        this.totalWithProduction = totalWithProduction;
    }
}

class DetailsRepository extends SavedInLocalStorage {
    #allDetails;

    constructor(allDetails = {}) {
        super();
        this.#allDetails = allDetails;
    }

    /**
     * @param id
     * @param message {Details}
     */
    add(id, message) {
        this.#allDetails[id] = message;
        this.saveToLocalStorage();
    }

    /**
     * @param id
     * @param report
     * @param reportDate {Number}
     * @param cb
     * @returns {Promise<null>}
     */
    get(id, report, reportDate, cb) {
        let details = this.#allDetails[id];
        if (details !== undefined) {
            console.log(`Using details from repository for ${id}`);
            return Promise.resolve(cb(details));
        } else {
            console.log(`Getting details for ${id}`);
            return Promise.resolve($.get('index.php?page=messages', {ajax: 1, messageId: id}, (detailedReport) => {
                details = Details.fromDetailedReport(report, new Date(reportDate), $(detailedReport));
                SpyHelper.detailsRepository.add(id, details);
                cb(details);
            }))
        }
    }

    getCached(id) {
        return this.#allDetails[id];
    }

    remove(id) {
        delete this.#allDetails[id];
        this.saveToLocalStorage();
    }

    static get saveName() {
        return `${SCRIPT_NAME}_${UNIVERSE}_details`;
    }

    toJson() {
        let json = {};
        for (let id in this.#allDetails) {
            if (this.#allDetails.hasOwnProperty(id)) {
                json[id] = this.#allDetails[id].toJson();
            }
        }
        return json;
    }

    static fromJson(json) {
        if (json === null) {
            return new DetailsRepository();
        } else {
            let details = {};
            for (let id in json) {
                if (json.hasOwnProperty(id)) {
                    details[id] = Details.fromJson(json[id]);
                }
            }
            return new DetailsRepository(details);
        }
    }

    /**
     * @returns {DetailsRepository}
     */
    static loadFromLocalStorage() {
        return this.load(DetailsRepository);
    }

    saveToLocalStorage() {
        this.save(DetailsRepository);
    }
}

class Saves extends SavedInLocalStorage {
    researches;
    defaultProbes;
    lastSortKey;
    lastSortOrder;

    constructor(researches = new Researches(), defaultProbes = 1, lastSortKey = 'date', lastSortOrder = -1) {
        super();
        this.researches = researches;
        this.defaultProbes = defaultProbes;
        this.lastSortKey = lastSortKey;
        this.lastSortOrder = lastSortOrder;
    }

    get combustionDrive() {
        return this.researches.levelOf(COMBUSTION_DRIVE)
    }
    get impulseDrive() {
        return this.researches.levelOf(IMPULSE_DRIVE)
    }
    get hyperspaceDrive() {
        return this.researches.levelOf(HYPERSPACE_DRIVE)
    }
    get weaponsTechnology() {
        return this.researches.levelOf(WEAPONS_TECHNOLOGY)
    }
    get shieldingTechnology() {
        return this.researches.levelOf(SHIELDING_TECHNOLOGY)
    }
    get armourTechnology() {
        return this.researches.levelOf(ARMOUR_TECHNOLOGY)
    }

    updateResearch() {
        const researches = new BetterMap();
        researches.set(ENERGY_TECHNOLOGY, SpyHelper.getResearch(ENERGY_TECHNOLOGY));
        researches.set(LASER_TECHNOLOGY, SpyHelper.getResearch(LASER_TECHNOLOGY));
        researches.set(ION_TECHNOLOGY, SpyHelper.getResearch(ION_TECHNOLOGY));
        researches.set(HYPERSPACE_TECHNOLOGY, SpyHelper.getResearch(HYPERSPACE_TECHNOLOGY));
        researches.set(PLASMA_TECHNOLOGY, SpyHelper.getResearch(PLASMA_TECHNOLOGY));
        researches.set(ESPIONAGE_TECHNOLOGY, SpyHelper.getResearch(ESPIONAGE_TECHNOLOGY));
        researches.set(COMPUTER_TECHNOLOGY, SpyHelper.getResearch(COMPUTER_TECHNOLOGY));
        researches.set(ASTROPHYSICS, SpyHelper.getResearch(ASTROPHYSICS));
        researches.set(INTERGALACTIC_RESEARCH_NETWORK, SpyHelper.getResearch(INTERGALACTIC_RESEARCH_NETWORK));
        researches.set(GRAVITON_TECHNOLOGY, SpyHelper.getResearch(GRAVITON_TECHNOLOGY));
        researches.set(COMBUSTION_DRIVE, SpyHelper.getResearch(COMBUSTION_DRIVE));
        researches.set(IMPULSE_DRIVE, SpyHelper.getResearch(IMPULSE_DRIVE));
        researches.set(HYPERSPACE_DRIVE, SpyHelper.getResearch(HYPERSPACE_DRIVE));
        researches.set(WEAPONS_TECHNOLOGY, SpyHelper.getResearch(WEAPONS_TECHNOLOGY));
        researches.set(SHIELDING_TECHNOLOGY, SpyHelper.getResearch(SHIELDING_TECHNOLOGY));
        researches.set(ARMOUR_TECHNOLOGY, SpyHelper.getResearch(ARMOUR_TECHNOLOGY));

        this.researches = new Researches(researches);
        this.saveToLocalStorage();
        console.log("Updated researches")
    }

    updateDefaultProbes() {
        this.defaultProbes = SpyHelper.getDefaultProbes();
        this.saveToLocalStorage();
        console.log("Updated default probes sent")
    }

    static get saveName() {
        return `${SCRIPT_NAME}_${UNIVERSE}`;
    }

    toJson() {
        return {
            researches: this.researches.toJson(),
            defaultProbes: this.defaultProbes,
            lastSortKey: this.lastSortKey,
            lastSortOrder: this.lastSortOrder
        }
    }

    static fromJson(json) {
        if (json === null) {
            return new Saves();
        } else {
            return new Saves(Researches.fromJson(json.researches), json.defaultProbes, json.lastSortKey, json.lastSortOrder)
        }
    }

    /**
     * @returns {Saves}
     */
    static loadFromLocalStorage() {
        return this.load(Saves);
    }

    saveToLocalStorage() {
        this.save(Saves);
    }
}

window.Saves = Saves;

let SpyHelper = {
    detailsRepository: DetailsRepository.loadFromLocalStorage(),
    saves: Saves.loadFromLocalStorage(),
    universe: Universe.loadFromLocalStorage(),
    /**
     * @type {Array<Message | Report>}
     */
    messages: [],
    isRunning: false,
    /***********************************************UTILITIES**************************************************************/
    beautify: function(number) {
        number = Math.round(number);
        if (number > 1e3) {
            const exp = Math.floor((number.toString().length - 1) / 3);
            const digits = 1;
            const rounded = Math.round(number / Math.pow(10, (exp * 3) - digits)) / Math.pow(10, digits);
            return rounded + SHORT_SCALE[exp - 1];
        }
        return number;
    },

    /**
     * Writes a string saying time
     * @param seconds
     * @returns {string}
     */
    timeString: function(seconds) {
        let remainingSeconds, showString = "";
        function add(string) {
            if (showString === "") {
                return string;
            } else {
                return showString + " " + string;
            }
        }
        remainingSeconds = seconds;
        const years = Math.floor(remainingSeconds / (365 * 24 * 60 * 60));
        if (years > 0) {
            let yearString = 'years';
            if (years === 1) yearString = 'year';
            showString = add(years + yearString);
            remainingSeconds -= years * 365 * 24 * 60 * 60;
        }

        const months = Math.floor(remainingSeconds / (30 * 24 * 60 * 60));
        if (months > 0) {
            let monthString = 'months';
            if (months === 1) monthString = 'month';
            showString = add(months + monthString);
            remainingSeconds -= months * 30 * 24 * 60 * 60;
        }

        const weeks = Math.floor(remainingSeconds / (7 * 24 * 60 * 60));
        if (weeks > 0) {
            showString = add(weeks + "w");
            remainingSeconds -= weeks * 7 * 24 * 60 * 60;
        }

        const days = Math.floor(remainingSeconds / (24 * 60 * 60));
        if (days > 0) {
            showString = add(days + "d");
            remainingSeconds -= days * 24 * 60 * 60;
        }

        const hours = Math.floor(remainingSeconds / (60 * 60));
        if (hours > 0) {
            showString = add(hours + "h");
            remainingSeconds -= hours * 60 * 60;
        }

        const minutes = Math.floor(remainingSeconds / 60);
        if (minutes > 0) {
            showString = add(minutes + "m");
            remainingSeconds -= minutes * 60;
        }

        /*if (remainingSeconds > 1 || (minutes + hours + days === 0))
            showString = add(Math.floor(remainingSeconds) + "s");*/
        return showString;
    },

    createElementWithClass: function(tagName, classes) {
        let element = document.createElement(tagName);
        element.className = classes;
        return element;
    },

    createSortableTD: function (parent, msgId, classes, sortkey, numericContent) {
        const td = SpyHelper.createElementWithClass('td', classes);
        SpyHelper.addIdAndSortKey(td, msgId, sortkey);
        td.textContent = SpyHelper.beautify(numericContent);
        parent.appendChild(td);
    },

    createUnsortableTD: function (parent, classes, numericContent) {
        const td = SpyHelper.createElementWithClass('td', classes + ' not_sortable');
        td.textContent = SpyHelper.beautify(numericContent);
        parent.appendChild(td);
    },

    addIdAndSortKey: function(element, msgId, sortKey) {
        element.sortKey = sortKey;
        element.id = `${msgId}.${sortKey}`;
    },

    addTooltip: function(selector, tooltipText) {
        Tipped.create(selector, tooltipText, getTooltipOptions(selector))
    },

    /************************************************RESEARCH**************************************************************/
    getResearch: function(research) {
        return parseInt($($(`[data-technology=${research.id}]`).find(".level").get(0)).attr("data-value"));
    },

    getDefaultProbes: function() {
        return window.spionageAmount || SpyHelper.saves.defaultProbes;
    },

    /**
     *
     * @param coordinates {Coordinates}
     * @param shipCount
     * @returns {*}
     */
    newSpyIcon: function(coordinates, shipCount) {
        let probeIcon = ESPIONAGE_PROBE_ICON;
        let href;
        let onclick;
        if (shipCount === SpyHelper.saves.defaultProbes) {
            href = 'javascript:void(0)';
            onclick = function(event) {
                SpyHelper.sendProbes(ESPIONAGE, coordinates.galaxy, coordinates.system, coordinates.position, coordinates.type, shipCount, event.target);
                return false;//Returning false cancels the event(that would open the link).
            };
            /*let href = 'javascript:SpyHelper.sendProbes(' + ESPIONAGE + ', ' +
                coordinates.galaxy + ', ' + coordinates.system + ', ' + coordinates.position + ', ' + coordinates.type + ', ' +
                shipCount + ', ' + id + ')';*/
        } else {
            probeIcon += ' more';
            let targetPartialLink = 'ingame&component=fleetdispatch&galaxy=' + coordinates.galaxy + '&system=' + coordinates.system + '&position=' + coordinates.position +
                '&type=' + coordinates.type + '&mission=' + ESPIONAGE + '&am' + ESPIONAGE_PROBE.id + '=' + shipCount;
            href = location.href.replace('messages', targetPartialLink);
        }
        return SpyHelper.newIcon(probeIcon, href, onclick);
    },

    newCargoIcon: function(mission, coordinates, shipCount, id, iconName, shipID) {
        let targetPartialLink = 'ingame&component=fleetdispatch&galaxy=' + coordinates.galaxy + '&system=' + coordinates.system + '&position=' + coordinates.position +
            '&type=' + coordinates.type + '&mission=' + mission + '&am' + shipID + '=' + shipCount;
        let href = location.href.replace('messages', targetPartialLink);
        return SpyHelper.newIcon(iconName, href);
    },

    newSimulateIcon: function(report) {
        let apiKey = $(report).find('.icon_apikey').get(0).parentNode.href.replace('ogame-api://', '');
        let href = 'http://topraider.eu/index.php?SR_KEY=' + apiKey +
            '&combu' + SpyHelper.saves.combustionDrive +
            '&impu' + SpyHelper.saves.impulseDrive +
            '&prop' + SpyHelper.saves.hyperspaceDrive +
            '&arme' + SpyHelper.saves.weaponsTechnology +
            '&bouclier' + SpyHelper.saves.shieldingTechnology +
            '&protect' + SpyHelper.saves.armourTechnology +
            '&speed' + document.getElementsByName('ogame-universe-speed-fleet')[0].content;
        let icon = SpyHelper.newIcon(SIM_ICON, href);
        icon.target = SCRIPT_NAME;
        return icon;
    },

    newDeleteIcon: function(classes, href) {
        let icon = SpyHelper.createElementWithClass('a', 'spy_helper default fright ' + classes);
        icon.href = href;
        return icon;
    },

    newIcon: function(classes, href, onclick) {
        let icon = SpyHelper.createElementWithClass('a', 'icon_nf_link fleft');
        icon.onclick = onclick;
        icon.href = href;
        let span = SpyHelper.createElementWithClass('span', 'spy_helper default ' + classes);
        icon.appendChild(span);
        return icon;
    },

    sendProbes: function(mission, galaxy, system, position, type, shipCount, target) {
        let params = {
            mission: mission,
            galaxy: galaxy,
            system: system,
            position: position,
            type: type,
            shipCount: shipCount,
            token: miniFleetToken
        };
        let success;
        let request = $.ajax(miniFleetLink, {
            data: params,
            dataType: "json",
            type: "POST",
            success: function(data) {
                if (data.newToken !== undefined) {
                    miniFleetToken = data.newToken
                }
                success = data.response.success;
            }
        });
        $.when(request).done(() => {
            if (success) {
                target.className += ' succes';
            } else {
                target.className += ' failed';
            }
        })
    },

    /**
     * @param string Takes in a string with a format "name: value" and returns value.
     * @returns {Number}
     */
    parseTextNumber: function(string) {
        let numberWithDots = /\D*((\d+\.?)+)/g.exec(string)[1];
        return parseInt(numberWithDots.replace(/[^0-9]+/g, ''));
    },

    /**
     * @param res {Resources}
     * @returns {number}
     */
    calculateCapacityNeeded: function(res) {
        return Math.max(res.total, Math.min(0.75 * (2 * res.metal + res.crystal + res.deuterium), 2 * res.metal + res.deuterium)) * res.plunderRatio;
    },

    compact: function(report) {
        let compactings = $(report).find('.compacting');
        compactings.get(4).remove();
        compactings.get(3).remove();
        compactings.get(2).remove();
        compactings.get(0).remove();
        $(report).find('.msg_sender,.msg_sender_label,br').remove();
    },

    /**
     * @param detail from the detailed report
     * @param dataType Determines what we are looking for
     * @return {object} success field contains a boolean whether the thing we are looking for was in the detail report or not
     *      Fields are the name of the thing
     */
    getArrayDetails: function(detail, dataType) {
        let returnObject = {seen: false};
        const detailAtId = $(detail.find(`[data-type="${dataType}"]`));
        if ($(detailAtId).find('.detail_list_fail').length === 0) {
            let children = detailAtId.find('.detail_list_el');
            for (let i = 0; i < children.length; i++) {
                const element = children.get(i);
                const name = $(element).find('.detail_list_txt').get(0).innerHTML;
                returnObject[name] = SpyHelper.parseTextNumber($(element).find('.fright').get(0).innerHTML);
            }
            returnObject.seen = true;
        }
        return returnObject;
    },

    /**
     * @param msgId
     * @param details {Details}
     * @param maxProfit
     * @param reportDate {Date}
     * @param maxProfitWithFallback {Number}
     * @returns {HTMLTableRowElement}
     */
    generatePlunderRow: function(msgId, details, maxProfit, reportDate, maxProfitWithFallback) {
        const resources = details.resources;
        const plunderRow = document.createElement('tr');
        const plunderTitle = SpyHelper.createElementWithClass('td', 'left');
        plunderTitle.textContent = 'Plunder';
        plunderRow.appendChild(plunderTitle);
        SpyHelper.createSortableTD(plunderRow, msgId, 'metal', 'resources.metalPlunder', resources.metalPlunder);
        SpyHelper.createSortableTD(plunderRow, msgId, 'crystal', 'resources.crystalPlunder', resources.crystalPlunder);
        SpyHelper.createSortableTD(plunderRow, msgId, 'deuterium', 'resources.deuteriumPlunder', resources.deuteriumPlunder);
        SpyHelper.createSortableTD(plunderRow, msgId, '', 'resources.totalPlunder', resources.totalPlunder);
        let profit = SpyHelper.createElementWithClass('td', 'total center_text');
        let rowSpan = 2;
        if (details.debris.seen) {
            rowSpan = 3;
        }
        profit.rowSpan = rowSpan;
        SpyHelper.addIdAndSortKey(profit, msgId, 'total');
        if (maxProfitWithFallback > maxProfit) {
            profit.textContent = SpyHelper.beautify(maxProfitWithFallback);
            profit.className += ' purple'
        } else {
            profit.textContent = SpyHelper.beautify(maxProfit);
        }
        if (details.fleet.seen  && details.defences.seen && details.fleet.debris.total + details.defences.score === 0) {
            profit.className += ' green'
        }
        plunderRow.appendChild(profit);
        let age = SpyHelper.createElementWithClass('td', 'center_text');
        age.textContent = SpyHelper.timeString((NOW.getTime() - reportDate) / 1000) + " ago";
        age.rowSpan = rowSpan + 1;
        SpyHelper.addIdAndSortKey(age, msgId, "date");
        plunderRow.appendChild(age);
        return plunderRow;
    },

    /**
     * @param msgId
     * @param debris {Debris}
     * @returns {HTMLTableRowElement}
     */
    generateExistingDebrisRow: function(msgId, debris) {
        const debrisRow = document.createElement('tr');
        const debrisTitle = SpyHelper.createElementWithClass('td', 'left');
        debrisTitle.textContent = 'Existing Debris';
        debrisRow.appendChild(debrisTitle);
        SpyHelper.createSortableTD(debrisRow, msgId, 'metal', 'debris.metal', debris.metal);
        SpyHelper.createSortableTD(debrisRow, msgId, 'crystal', 'debris.crystal', debris.crystal);
        const empty = document.createElement('td');
        debrisRow.appendChild(empty);
        SpyHelper.createSortableTD(debrisRow, msgId, '', 'debris.total', debris.total);
        return debrisRow;
    },

    /**
     * @param msgId
     * @param fleet {Fleets}
     * @returns {HTMLTableRowElement}
     */
    generateFleetDebrisRow: function(msgId, fleet) {
        const empty = document.createElement('td');
        const fleetDebrisRow = document.createElement('tr');
        const debrisTitle = SpyHelper.createElementWithClass('td', 'left');
        debrisTitle.textContent = 'Fleet Debris';
        debrisTitle.id = `${msgId}.fleet`;
        fleetDebrisRow.appendChild(debrisTitle);
        const totalDebris = document.createElement('td');
        SpyHelper.addIdAndSortKey(totalDebris, msgId, 'fleet.debris.total');
        if (fleet.seen) {
            const fleetDebris = fleet.debris;
            SpyHelper.createSortableTD(fleetDebrisRow, msgId, 'metal', 'fleet.debris.metal', fleetDebris.metal);
            SpyHelper.createSortableTD(fleetDebrisRow, msgId, 'crystal', 'fleet.debris.crystal', fleetDebris.crystal);
            fleetDebrisRow.appendChild(empty);
            const totalFleetDebris = fleetDebris.total;
            totalDebris.textContent = SpyHelper.beautify(totalFleetDebris);
            if (totalFleetDebris === 0) {
                totalDebris.className = 'green';
            }
        } else {
            let notSeen = SpyHelper.createElementWithClass('td', 'red');
            notSeen.colSpan = 4;
            notSeen.textContent = 'Fleet not seen in report.';
            fleetDebrisRow.appendChild(notSeen);
        }
        fleetDebrisRow.appendChild(totalDebris);
        return fleetDebrisRow;
    },

    /**
     * @param msgId
     * @param resources {Resources}
     * @param production {Resources | NotSeenSection}
     * @param totalWithProduction {Number}
     * @param productionWithFallback {Resources | NotSeenSection}
     * @param maxProfitWithFallbackAndProduction {Number}
     * @returns {HTMLTableRowElement}
     */
    generateProductionRow: function (msgId, resources, production, totalWithProduction, productionWithFallback, maxProfitWithFallbackAndProduction) {
        function productionCells(productionRow, resources, production, totalWithProduction, totalClasses = "") {
            SpyHelper.createUnsortableTD(productionRow, 'metal', production.metalPlunder);
            SpyHelper.createUnsortableTD(productionRow, 'crystal', production.crystalPlunder);
            SpyHelper.createUnsortableTD(productionRow, 'deuterium', production.deuteriumPlunder);
            SpyHelper.createUnsortableTD(productionRow, "", production.totalPlunder);
            SpyHelper.createSortableTD(productionRow, msgId, `center_text ${totalClasses}`, 'totalWithProduction', totalWithProduction);
        }

        let productionRow = document.createElement('tr');
        let mineTitle = SpyHelper.createElementWithClass('td', 'left');
        mineTitle.textContent = 'Production';
        productionRow.appendChild(mineTitle);
        if (production.seen) {
            productionCells(productionRow, resources, production, totalWithProduction);
        } else if (productionWithFallback.seen) {
            productionCells(productionRow, resources, productionWithFallback, maxProfitWithFallbackAndProduction, "purple");
        } else {
            let notSeen = SpyHelper.createElementWithClass('td', 'red center_text not_sortable');
            notSeen.textContent = 'Buildings not seen in report.';
            notSeen.colSpan = 4;
            productionRow.appendChild(notSeen);
        }
        return productionRow;
    },

    /**
     * @param researches {Researches | NotSeenSection}
     * @param researchesWithFallback {Researches | NotSeenSection}
     * @returns {HTMLTableRowElement}
     */
    generateTechsRow: function(researches, researchesWithFallback) {
        let techs = document.createElement('tr');
        let techsTitle = SpyHelper.createElementWithClass('td', 'left');
        techsTitle.textContent = 'Techs';
        techs.appendChild(techsTitle);
        let techsText = SpyHelper.createElementWithClass('td', 'not_sortable');
        if (researches.seen) {
            techsText.textContent = `${researches.levelOf(WEAPONS_TECHNOLOGY)}/${researches.levelOf(SHIELDING_TECHNOLOGY)}/${researches.levelOf(ARMOUR_TECHNOLOGY)}` ;
        } else if (researchesWithFallback.seen) {
            techsText.textContent = `${researchesWithFallback.levelOf(WEAPONS_TECHNOLOGY)}/${researchesWithFallback.levelOf(SHIELDING_TECHNOLOGY)}/${researchesWithFallback.levelOf(ARMOUR_TECHNOLOGY)}` ;
            techsText.className = 'purple';
        } else {
            techsText.className = 'red center_text not_sortable';
            techsText.textContent = 'Not seen.';
        }

        techs.appendChild(techsText);
        return techs;
    },

    /**
     * @param msgId
     * @param defences {Defences | NotSeenSection}
     * @param defencesWithFallback {Defences | NotSeenSection}
     * @returns {HTMLTableRowElement}
     */
    generateDefencesRow: function(msgId, defences, defencesWithFallback) {
        function setTextContent(defenseScoreText, defences, className = "") {
            const score = defences.score;
            defenseScoreText.textContent = SpyHelper.beautify(score);
            defenseScoreText.className = className;
            const missiles = defences.amountOf(ANTI_BALLISTIC_MISSILES);
            if (missiles > 0) {
                defenseScoreText.textContent += `/${SpyHelper.beautify(missiles)}`;
            }
            if (score === 0) {
                defenseScoreText.className += ' green';
            }
        }

        let defense = document.createElement('tr');
        let defenseTitle = SpyHelper.createElementWithClass('td', 'left');
        defenseTitle.textContent = 'Defense';
        defense.appendChild(defenseTitle);
        let defenseScoreText = document.createElement('td');
        SpyHelper.addIdAndSortKey(defenseScoreText, msgId, 'defense.score');
        defenseScoreText.id = `${msgId}.defense`;
        if (defences.seen) {
            setTextContent(defenseScoreText, defences);
        } else if (defencesWithFallback.seen) {
            setTextContent(defenseScoreText, defencesWithFallback, "purple");
        } else {
            defenseScoreText.className = 'red';
            defenseScoreText.textContent = 'Not seen.';
        }
        defense.appendChild(defenseScoreText);
        return defense;
    },

    generateActivityRow: function (lastActivity) {
        let activity = document.createElement('tr');
        let activityTitle = SpyHelper.createElementWithClass('td', 'left');
        activityTitle.textContent = 'Activity';
        activity.appendChild(activityTitle);
        let activityText = SpyHelper.createElementWithClass('td', 'not_sortable');
        activityText.textContent = lastActivity + ' mins';
        if (lastActivity === '<15') {
            activityText.className += ' red'
        } else if (lastActivity !== '>60') {
            activityText.className += ' yellow'
        }
        activity.appendChild(activityText);
        return activity;
    },

    generateCounterEspionageRow: function (counterEspionage) {
        let counterEspionageRow = document.createElement('tr');
        let activityTitle = SpyHelper.createElementWithClass('td', 'left');
        activityTitle.textContent = 'Counter';
        counterEspionageRow.appendChild(activityTitle);
        let activityText = SpyHelper.createElementWithClass('td', 'not_sortable');
        activityText.textContent = `${counterEspionage}%`;
        counterEspionageRow.appendChild(activityText);
        return counterEspionageRow;
    },

    calculateMaxProfitWithFallback(details, celestialBody, production, productionWithFallback) {
        let maxProfitWithFallback = details.resources.totalPlunder;
        let maxProfitWithProductionWithFallback = null;
        if (details.debris.seen) {
            maxProfitWithFallback += details.debris.total;
        }
        if (details.fleet.seen) {
            maxProfitWithFallback += details.fleet.debris.total;
            if (details.defences.seen) {
                maxProfitWithFallback += details.defences.debris.total;
                if (production.seen) {
                    maxProfitWithProductionWithFallback = maxProfitWithFallback + production.totalPlunder;
                }
            }
        }
        if (!details.defences.seen && celestialBody.defences.seen) {
            maxProfitWithFallback += celestialBody.defences.debris.total;
        }
        if (!production.seen && productionWithFallback.seen) {
            maxProfitWithProductionWithFallback = maxProfitWithFallback + productionWithFallback.totalPlunder;
        }
        return [maxProfitWithFallback, maxProfitWithProductionWithFallback];
    },

    calculateProductionWithFallback: function (player, celestialBody, details, reportDate, coordinates, clazz) {
        let researches = details.researches;
        if (!details.researches.seen && player !== undefined) {
            researches = player.researches;
        }
        let productionWithFallback = NotSeenSection.instance;
        if (celestialBody.buildings.seen) {
            productionWithFallback = celestialBody.buildings.production(details.resources, reportDate, researches, coordinates, clazz);
        }
        return productionWithFallback;
    },

    /**
     * @param msgId
     * @param coordinates {Coordinates}
     * @param details {Details}
     * @param reportDate {Date}
     * @param activity {String}
     * @param production {Resources | NotSeenSection}
     * @param maxProfit {Number}
     * @param maxProfitWithProduction {Number}
     * @param counterEspionage {String}
     * @param celestialBody {CelestialBody}
     * @param player {Player | undefined}
     * @param clazz {Class}
     * @returns {HTMLTableRowElement}
     */
    createTables: function(msgId, coordinates, details, reportDate, activity, production, maxProfit, maxProfitWithProduction, counterEspionage, celestialBody, player, clazz) {
        let div = SpyHelper.createElementWithClass('div', 'compacting sortable');
        let leftTable = SpyHelper.createElementWithClass('table', 'left_table');

        let productionWithFallback = this.calculateProductionWithFallback(player, celestialBody, details, reportDate, coordinates, clazz);
        const [maxProfitWithFallback, maxProfitWithFallbackAndProduction] = SpyHelper.calculateMaxProfitWithFallback(details, celestialBody, production, productionWithFallback);

        leftTable.appendChild(SpyHelper.generatePlunderRow(msgId, details, maxProfit, reportDate, maxProfitWithFallback));

        if (details.debris.seen) {
            leftTable.appendChild(SpyHelper.generateExistingDebrisRow(msgId, details.debris))
        }

        leftTable.appendChild(SpyHelper.generateFleetDebrisRow(msgId, details.fleet));

        leftTable.appendChild(SpyHelper.generateProductionRow(msgId, details.resources, production, maxProfitWithProduction, productionWithFallback, maxProfitWithFallbackAndProduction));
        div.appendChild(leftTable);
        let rightTable = SpyHelper.createElementWithClass('table', 'right_table');
        rightTable.appendChild(SpyHelper.generateActivityRow(activity));
        rightTable.appendChild(SpyHelper.generateDefencesRow(msgId, details.defences, celestialBody.defences));
        let researchesWithFallback = NotSeenSection.instance;
        if (player !== undefined) {
            researchesWithFallback = player.researches
        }
        rightTable.appendChild(SpyHelper.generateTechsRow(details.researches, researchesWithFallback));
        rightTable.appendChild(SpyHelper.generateCounterEspionageRow(counterEspionage));
        div.appendChild(rightTable);
        return div;
    },

    sortMessages: function(event) {
        let stoppedObservers = SpyHelper.stopObservers(); //Stop observing while we sort.
        if (stoppedObservers === false) return; //Observers were already stopped we can't sort at this time.
        let sortKey;
        if (event === undefined) {
            sortKey = SpyHelper.saves.lastSortKey; //If no arguments sort by last sorted
        } else {
            sortKey = event.currentTarget.sortKey;
            if (SpyHelper.saves.lastSortKey === sortKey) {
                //Swap sort order
                SpyHelper.saves.lastSortOrder *= -1;
            } else {
                //Default to descending
                SpyHelper.saves.lastSortOrder = -1;
            }
            SpyHelper.saves.lastSortKey = sortKey;
        }
        console.log('Sorting by: ' + sortKey);
        SpyHelper.saves.saveToLocalStorage(); //Save lastSortOrder and lastSortKey.

        sortKey = sortKey.split('.');
        SpyHelper.messages.sort(function (a, b) {
            function getValue(value, sortKey) {
                if (isNaN(value)) {
                    value = value[sortKey];
                    if (value instanceof NotSeenSection) {
                        value = 1e50 * SpyHelper.saves.lastSortOrder
                    } else if (value === undefined) {
                        value = Infinity * SpyHelper.saves.lastSortOrder;
                    }
                }

                return value;
            }
            let o1 = a;
            let o2 = b;
            for (let i = 0; i< sortKey.length; i++) {
                const innerID = sortKey[i];
                o1 = getValue(o1, innerID);
                o2 = getValue(o2, innerID);
            }
            if (o1 === o2) {
                return 0;
            }
            if (o1 < o2) {
                return -1 * SpyHelper.saves.lastSortOrder;
            } else if (o1 > o2) {
                return SpyHelper.saves.lastSortOrder;
            }
        });
        SpyHelper.messages.forEach(message => {
            const report = message.report;
            report.parentNode.appendChild(report)
        });

        SpyHelper.addTooltips();
        SpyHelper.startMessagesObservers(); //Restart observers now that we are done.
    },

    /**
     * Gets the date from this report adds the needed css to make it be sortable and adds the event listener
     * @param report Report we are getting the date from
     * @param msgId
     * @returns {number} Date of the report
     */
    getParsedDate: function (report, msgId) {
        const date = $(report).find('.msg_date');
        date.addClass('sortable');
        const dateElement = date.get(0);
        SpyHelper.addIdAndSortKey(dateElement, msgId, 'date');
        const dateString = dateElement.innerHTML;
        // day 1
        // month 2
        // year 3
        // hour 4
        // min 5
        // sec 6
        const m = /(\d+)\.(\d+)\.(\d+) (\d+):(\d+):(\d+)/g.exec(dateString);
        $(report).find('.msg_date').on('click', SpyHelper.sortMessages);
        return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6])).getTime();
    },

    parseGalaxy: function() {
        $(".row").toArray().forEach(row => {
            const row$ = $(row);
            const colonized = row$.find(".colonized").get(0);
            if (colonized !== undefined) {
                const planetID = parseInt($(colonized).attr("data-planet-id"));
                const coordinates = Coordinates.fromText(row$.find(".position").attr("data-coords"), PLANET);
                const moonID = parseInt($(row$.find(".moon").get(0)).attr("data-moon-id"));
                let moon = undefined;
                if (!isNaN(moonID)) {
                    moon = SpyHelper.universe.updateMoonWithId(moonID, coordinates.moonCoordinates(), undefined);
                }

                const planet = SpyHelper.universe.updatePlanetWithId(planetID, coordinates, moon);

                const playerNameElement = row$.find(".playername");
                const playerID = playerNameElement.find("[data-playerid]").attr("data-playerid");
                SpyHelper.universe.updatePlayerWithId(playerID, undefined); //This creates the player if it does not exist.
                SpyHelper.universe.addPlanetToPlayer(planet, playerID)
            }
        })
    },

    addTooltips: function() {
        SpyHelper.messages
            .filter(message => message instanceof Report)
            .forEach(message => {
                SpyHelper.addTooltip(`#${message.id}\\.defense`, message.defense.tooltipText);
                SpyHelper.addTooltip(`#${message.id}\\.fleet`, message.fleet.tooltipText);
            })
    },

    deleteAllAbove: function(id) {
        console.log("Deleting all above " + id);
        SpyHelper.stopObservers();
        const deletes = [];
        const reports = SpyHelper.messages.filter(message => message instanceof Report);
        let delay = 0;
        for (const message of reports) {
            const messageID = message.id;
            deletes.push(SpyHelper.deleteMessageWithDelay(messageID, delay));
            delay += DELAY_BETWEEN_DELETES;
            if (messageID === id) {
                break;
            }
        }
        return Promise.all(deletes).then(() => {
            SpyHelper.startMessagesObservers();
        });
    },

    deleteAllBelow: function(id) {
        console.log("Deleting all below " + id);
        SpyHelper.stopObservers();
        const deletes = [];
        const reports = SpyHelper.messages.filter(message => message instanceof Report);
        let delay = 0;
        for (const message of reports.reverse()) {
            const messageID = message.id;
            deletes.push(SpyHelper.deleteMessageWithDelay(messageID, delay));
            delay += DELAY_BETWEEN_DELETES;
            if (messageID === id) {
                break;
            }
        }
        return Promise.all(deletes).then(() => {
            SpyHelper.startMessagesObservers();
        });
    },

    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    deleteMessageWithDelay: function(id, delay) {
        return SpyHelper.sleep(delay).then(() => {
            return SpyHelper.deleteMessage(id)
        });
    },

    deleteMessage: function(id) {
        return Promise.resolve($.ajax({
            type: "POST",
            url: "?page=messages",
            dataType: "json",
            data: {
                messageId: id,
                action: 103,
                ajax: 1
            },
            success: (c) => {
                //c should just be an object that contains a key of id to a boolean, that represents if message was deleted
                if (c[id] === true) {
                    SpyHelper.messages = SpyHelper.messages.filter(message => message.id !== id);
                    $(`#m${id}`).remove();
                    SpyHelper.detailsRepository.remove(id);
                }
            },
            error: function() {}
        }))
    },

    getLastActivity: function (report) {
        try {
            return /\w+: (.?\d+) /g.exec($(report).find('.compacting').first().find('.fright').text())[1];
        } catch (e) {
            //This happens in destroyed planets, maybe consider getting the activity from details instead as it appears to always be there
            return '>60';
        }
    },

    getPlayerName: function (report) {
        return $(report).find('.compacting').first().children(':not(.ctn)').get(0).textContent.trim();
    },

    addPlayerAndClassToPlanetInfo: function (report, clazz) {
        let player = $(report).find('.compacting').first().children(':not(.ctn)').get(0);
        const classText = SpyHelper.createElementWithClass('span', clazz.color);
        classText.textContent = `${clazz.name}`;
        $(report).find('.msg_title.blue_txt').get(0).childNodes[0].remove(); //Removes long text saying 'Espionage report from'
        player.textContent = player.textContent.trim()//.replace(/\s+/g, ''); //Remove leading spaces
        let from = document.createElement('span');
        from.textContent = ' from ';
        let a = document.createElement('span');
        a.textContent = ' a ';
        let title = $(report).find('.msg_title');
        $(player).insertBefore(title);
        if (clazz !== NO_CLASS) {
            $(a).insertBefore(title);
            $(classText).insertBefore(title);
        }
        $(from).insertBefore(title);
        title.removeClass();

    },

    extractClass: function(report) {
        const classText = $(report).find(".compacting").get(1).textContent;
        return Class.fromName(/.+:\s*((\w| )+)/g.exec(classText)[1]);
    },

    extractCounterEspionage: function(report) {
        const counterEspionageText = $(report).find(".compacting").get(3).children[1].textContent;
        return parseInt(/.+:\s*(\d+)%/g.exec(counterEspionageText)[1]);
    },

    calculateProbesToSend: function(details, player) {
        function fromTechnology(espionage, targetEspionage) {
            return Math.max(SpyHelper.saves.defaultProbes, 7 - (espionage - targetEspionage) * Math.abs(espionage - targetEspionage))
        }

        function targetEspionageChanged(espionage, targetEspionage, details) {
            const espionageValue = SpyHelper.saves.defaultProbes + (espionage - targetEspionage) * Math.abs(espionage - targetEspionage)
            if (espionageValue <= 2) {
                return !details.fleet.seen
            } else if (espionageValue <= 3) {
                return !details.defences.seen
            } else if (espionageValue <= 5) {
                return !details.buildings.seen
            } else {
                return !details.researches.seen
            }
        }

        let probesToSend = SpyHelper.saves.defaultProbes;
        const espionage = SpyHelper.saves.researches.levelOf(ESPIONAGE_TECHNOLOGY);
        const targetEspionage = () => player.researches.levelOf(ESPIONAGE_TECHNOLOGY);
        if (details.researches.seen) {
            const targetEspionage = details.researches.levelOf(ESPIONAGE_TECHNOLOGY);
            probesToSend = fromTechnology(espionage, targetEspionage);
        } else if (player !== undefined && player.researches.seen && !targetEspionageChanged(espionage, targetEspionage(), details)) {
            probesToSend = fromTechnology(espionage, targetEspionage());
        } else if (!details.fleet.seen) {
            probesToSend += 8; //Minimum amount to see all, not certain!
        } else {
            if (!details.defences.seen) probesToSend += 1;
            if (!details.buildings.seen) probesToSend += 2;
            if (!details.researches.seen) probesToSend += 2;
        }
        return probesToSend;
    },

    /**
     * @param msgId
     * @param report
     * @param details {Details}
     * @param coordinates {Coordinates}
     * @param iconDiv
     * @param reportDate {Date}
     */
    handleReportWithDetails(msgId, report, details, coordinates, iconDiv, reportDate) {
        const resources = details.resources;
        const debris = details.debris;
        const fleet = details.fleet;
        const defences = details.defences;
        const buildings = details.buildings;
        const researches = details.researches;
        const counterEspionage = SpyHelper.extractCounterEspionage(report);
        const clazz = SpyHelper.extractClass(report);
        let celestialBody;
        if (coordinates.type === PLANET) {
            celestialBody = SpyHelper.universe.updatePlanetAt(coordinates, buildings, defences)
        } else {
            celestialBody = SpyHelper.universe.updateMoonAt(coordinates, buildings, defences)
        }
        const playerName = SpyHelper.getPlayerName(report);
        const player = SpyHelper.universe.updatePlayerNamed(playerName, researches);

        let production = NotSeenSection.instance;
        if (buildings.seen) {
            production = buildings.production(resources, reportDate, researches, coordinates, clazz);
        }

        const tableElement = $(report).find('.msg_content').find('.compacting').get(1);
        const activity = SpyHelper.getLastActivity(report);
        let maxProfit = resources.totalPlunder;
        let maxProfitWithProduction = null;
        if (debris.seen) {
            maxProfit += debris.total;
        }
        if (fleet.seen) {
            maxProfit += fleet.debris.total;
            if (defences.seen) {
                maxProfit += defences.debris.total;
                if (production.seen) {
                    maxProfitWithProduction = maxProfit + production.totalPlunder;
                }
            }
        }
        SpyHelper.addPlayerAndClassToPlanetInfo(report, clazz);
        $(tableElement).replaceWith(
            SpyHelper.createTables(msgId, coordinates, details, reportDate, activity, production, maxProfit, maxProfitWithProduction, counterEspionage, celestialBody, player, clazz)
        );
        SpyHelper.compact(report);
        const capacityNeeded = SpyHelper.calculateCapacityNeeded(resources);
        const probesToSend = SpyHelper.calculateProbesToSend(details, player);
        const deleteButton = $(report).find('.js_actionKill').parent();
        deleteButton.prop('href', `javascript:SpyHelper.deleteMessage(${msgId})`); //Make delete button actually delete.
        $(report).find('.sortable > table > tr :nth-child(n+2):not(:empty):not(.not_sortable)').on('click', SpyHelper.sortMessages);
        $(iconDiv).find('.txt_link').addClass('more_details');
        $(SpyHelper.newDeleteIcon("greater", `javascript:SpyHelper.deleteAllAbove(${msgId})`)).insertBefore(deleteButton);
        $(SpyHelper.newDeleteIcon("lesser", `javascript:SpyHelper.deleteAllBelow(${msgId})`)).insertAfter(deleteButton);
        iconDiv.append(SpyHelper.newSpyIcon(coordinates, probesToSend));
        iconDiv.append(SpyHelper.newCargoIcon(ATTACK, coordinates, Math.ceil(capacityNeeded / LARGE_CARGO.capacity), msgId, LARGE_CARGO_ICON, LARGE_CARGO.id));
        iconDiv.append(SpyHelper.newCargoIcon(ATTACK, coordinates, Math.ceil(capacityNeeded / SMALL_CARGO.capacity), msgId, SMALL_CARGO_ICON, SMALL_CARGO.id));
        //iconDiv.append(SpyHelper.newSimulateIcon(report, msgId));
        SpyHelper.messages.push(new Report(msgId, report, reportDate, coordinates, resources, fleet, defences, maxProfit, maxProfitWithProduction));
    },

    /**
     *
     * @param msgId
     * @param report
     * @returns {Promise<null>}
     */
    handleReport: function(msgId, report) {
        if (SpyHelper.messages.some(message => message.id === msgId)) {
            console.log(`Duplicate handling on ${msgId}`);
            return Promise.resolve(null);
        }
        const coordinates = Coordinates.fromReport(report);
        const iconDiv = $(report).find('.msg_actions').first();
        const reportDate = SpyHelper.getParsedDate(report, msgId);
        if ($(report).find('.msg_sender').get(0).innerHTML !== "Fleet Command" || coordinates.position > 15) {
            if (coordinates.position <= 15) {
                iconDiv.append(SpyHelper.newSpyIcon(coordinates, SpyHelper.saves.defaultProbes));
            }
            SpyHelper.messages.push(new Message(msgId, report, reportDate));
            return Promise.resolve(null);
        }
        return SpyHelper.detailsRepository.get(msgId, report, reportDate, (details) => {
            SpyHelper.handleReportWithDetails(msgId, report, details, coordinates, iconDiv, reportDate)
        });
    },

    runMessages: function() {
        const getRequests = $('.msg:visible').toArray().reduce((acc, report) => {
            const msgId = $(report).data('msg-id');
            acc.push(SpyHelper.handleReport(msgId, report));
            return acc;
        }, []);
        return  Promise.all(getRequests).then(() => {
            SpyHelper.startMessagesObservers();//Start observing page changes again, also sort messages wont sort if observers are not in place
            SpyHelper.sortMessages(); //Sort by date as that is the default
            SpyHelper.universe.saveToLocalStorage();
        });
    },

    /**
     * @param pageNumber
     * @param callback
     * @returns {Promise<null>}
     */
    getPage: function(pageNumber, callback) {
        return Promise.resolve($.ajax({
            type: "POST",
            url: "?page=messages",
            dataType: "html",
            data: {
                messageId: -1,
                tabid: 20, //Espionage
                action: 107,
                pagination: pageNumber,
                ajax: 1
            },
            success: callback
        }));
    },

    getFirstPage: function(gameContainer) {
        //if (SpyHelper.isRunning) return;
        console.log("Getting first page");
        SpyHelper.isRunning = true;
        SpyHelper.stopObservers(); //Stop observing while we add our stuff to the page
        function extractPageNumber(element) {
            return parseInt(/\d+\/(\d+)/g.exec(element.find('.curPage').get(0).innerHTML)[1])
        }

        let numberOfPages;
        try {
            numberOfPages = extractPageNumber(gameContainer);
            SpyHelper.getRemainingPages(gameContainer, numberOfPages);
        } catch (e) {
            //gameContainer.children().remove();
            SpyHelper.getPage(1, c => {
                numberOfPages = extractPageNumber($(c));
                //$(gameContainer).append($(c).find('.msg')); //Append all messages from this page to the message page.
                SpyHelper.getRemainingPages(gameContainer, numberOfPages);
            });
        }

    },

    getRemainingPages: function(gameContainer, numberOfPages) {
        let gets = [];
        for (let i = 2; i <= numberOfPages; i++) { //Skip page 1 as we already have it.
            console.log(`Getting page ${i}`);
            gets.push(SpyHelper.getPage(i, c => {
                const content = $(c).find('.msg');
                gameContainer.append(content); //Append all messages from this page to the message page.
            }));
        }
        Promise.all(gets).then(function() {
                //When we have added all messages to the page fix them up.
                $.when(SpyHelper.runMessages()).done(function () {
                    SpyHelper.isRunning = false;
                    $('.pagination').remove(); //Remove the page changer as we have all pages loaded already.
                    console.log("All done");
                })
            }
        );
    },

    createMessagesObservers: function() {
        const outerTarget = document.querySelector('#ui-id-2');
        //let innerTarget = outerTarget.querySelector('.ui-tabs-panel.ui-widget-content.ui-corner-bottom>.tab_inner');
        const innerTarget = outerTarget.querySelector('.ui-tabs-panel.ui-widget-content.ui-corner-bottom');
        let config = {childList : true};
        let outerObserver = new MutationObserver((mutations, instance) => {
            innerObserver.observe(outerTarget.querySelector('.ui-tabs-panel.ui-widget-content.ui-corner-bottom'), config);
            //ui-id-22
            //ui-tabs-panel ui-widget-content ui-corner-bottom
            //aria-hidden = false
            //fleetsgenericpage
            //fleettrashmessagespage
            SpyHelper.observers.inner.target = outerTarget.querySelector('.ui-tabs-panel.ui-widget-content.ui-corner-bottom');
            console.log("Outer changed");
        });

        let innerObserver = new MutationObserver((mutationRecordArray, instance) => {
            console.log("Inner changed");
            SpyHelper.getFirstPage($(innerTarget).find('.tab_inner'));
        });
        SpyHelper.observers = {
            outer: {
                target: outerTarget,
                instance: outerObserver
            },
            inner: {
                target: innerTarget,
                instance: innerObserver
            },
            config: config
        }
    },

    createAndStartGalaxyObservers: function() {
        const target = document.querySelector("#galaxyContent");
        const mutationObserver = new MutationObserver((mutationRecordArray, instance) => {
            SpyHelper.parseGalaxy()
        });
        mutationObserver.observe(target, {childList : true})
    },

    startObserver: function(observerObject) {
        try {
            observerObject.instance.observe(observerObject.target, SpyHelper.observers.config);
        } catch(e) {
            if( e.code === 8 ) {
                console.log("The target you're trying to observe doesn't exist! " + observerObject.target);
            }
        }
    },

    startMessagesObservers: function() {
        console.log('Starting Observers');
        if (SpyHelper.observers === undefined) {
            SpyHelper.createMessagesObservers();
        }
        SpyHelper.startObserver(SpyHelper.observers.outer);
        SpyHelper.startObserver(SpyHelper.observers.inner);
    },

    /**
     * @returns {boolean} Stops observers and returns true if there were observers to stop.
     */
    stopObservers: function() {
        console.log('Stopping Observers');
        //If observers are not initialized there is nothing to disconnect
        if (SpyHelper.observers !== undefined) {
            SpyHelper.observers.inner.instance.disconnect();
            SpyHelper.observers.outer.instance.disconnect();
            return true;
        }
        return false;
    },

    main: function() {
        if (/research/.test(location.href)) {
            //Currently viewing research page.
            SpyHelper.saves.updateResearch();
        } else if (/galaxy/.test(location.href)) {
            SpyHelper.saves.updateDefaultProbes();
            SpyHelper.createAndStartGalaxyObservers();
        } else if (/messages/.test(location.href)) {
            //Currently viewing messages page.
            SpyHelper.startMessagesObservers();
        }
    },

    addCSS: function() {
        let link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('type', 'text/css');
        link.setAttribute('href', 'https://web.tecnico.ulisboa.pt/samuel.a.martins/' + SCRIPT_NAME + '.css');
        document.head.appendChild(link);
    },

    initialize: function() {
        SpyHelper.addCSS();
        const updateEverything = SpyHelper.universe.updateEverything(UNIVERSE);
        const getUniverseProperties = UniverseProperties.get(UNIVERSE);
        Promise.all([updateEverything, getUniverseProperties]).then(() => {
            console.log("Initialized Spy Helper");
            SpyHelper.main()
        });
        /*$.when.apply($, [SpyHelper.universe.updateEverything(), UniverseProperties.get(UNIVERSE)]).done(() => {
            console.log("Initialized Spy Helper");
            SpyHelper.main()
        })*/
    }
};

window.SpyHelper = SpyHelper;
window.Coordinates = Coordinates;

$.fn.scrollView = function () {
    return this.each(function () {
        let elOffset = $(this).offset().top;
        let elHeight = $(this).height();
        let windowHeight = $(window).height();
        let offset;

        if (elHeight < windowHeight) {
            offset = elOffset - ((windowHeight / 2) - (elHeight / 2));
        }
        else {
            offset = elOffset;
        }
        $('html, body').animate({scrollTop: offset}, 1000);
    });
};

//$(window).ready(SpyHelper.initialize);
$(SpyHelper.initialize);