// ==UserScript==
// @name         SpyHelper3
// @version      3.0.0
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
import $ from "jquery"

const SCRIPT_NAME = "SpyHelper3"
const UNIVERSE = (document.getElementsByName("ogame-universe")[0] as HTMLMetaElement).content
const SAVE_NAME_PREFIX = `${SCRIPT_NAME}_${UNIVERSE.slice(0, 4)}`
const DELAY_BETWEEN_DELETES = 150
//Other Constant
const SHORT_SCALE = ["k", "M", "B", "T", "Q"]
const AVERAGE_TEMP = [220, 170, 120, 70, 60, 50, 40, 30, 20, 10, 0, -10, -50, -90, -130]
const FLEET_SECTION = "ships"
const DEFENCES_SECTION = "defense"
const BUILDINGS_SECTION = "buildings"
const RESEARCHES_SECTION = "research"
//Icon classes
const SIM_ICON = "sim"
const LARGE_CARGO_ICON = "large_cargo"
const SMALL_CARGO_ICON = "small_cargo"
const ESPIONAGE_PROBE_ICON = "probe"

enum Mission {
  EXPEDITION = 15,
  COLONIZE = 7,
  RECYCLE = 8,
  TRANSPORT = 3,
  DEPLOY = 4,
  ESPIONAGE = 6,
  ACS_DEFEND = 5,
  ATTACK = 1,
  ACS_ATTACK = 2,
  MOON_DESTROY = 9,
}

enum CelestialBodyType {
  PLANET = 1,
  DEBRIS_FIELD = 2,
  MOON = 3,
}

function celestialBodyFromID(id: number): CelestialBodyType {
  switch (id) {
    case 1: return CelestialBodyType.PLANET
    case 2: return CelestialBodyType.DEBRIS_FIELD
    case 3: return CelestialBodyType.MOON
    default: throw new Error("Invalid ID")
  }
}

/********************************************* Collections ************************************************************/
type Result<A> = Either<string, A>

interface Decoder<A> {
  decode(json: Object): Result<A>
}

interface Encoder<A> {
  encode(a: A): Object
}

interface Codec<A> extends Encoder<A>, Decoder<A> {
}

class PrimitiveCodec<A> implements Codec<A> {
  encode(a: A): Object {
    return a;
  }

  decode(json: Object): Result<A> {
    return new Right(json as A)
  }
}

class DateCodec implements Codec<Date> {
  encode(a: Date): Object {
    return Codecs.number.encode(a.getTime())
  }

  decode(json: Object): Result<Date> {
    return Optional.apply(json)
      .flatMap(json => Optional.parseInt(json as string))
      .map(timestamp => new Date(timestamp))
      .toRight(`Failed to parse date from ${json}`)
  }
}

class ArrayCodec<A> implements Codec<Array<A>> {
  private readonly codec: Codec<A>

  constructor(codec: Codec<A>) {
    this.codec = codec;
  }

  encode(a: Array<A>): Object {
    return Codecs.object.encode(a.map(this.codec.encode))
  }

  decode(json: Object): Result<Array<A>> {
    return Codecs.object.decode(json).flatMap(jsonObject => {
      const startingValue: Right<string, Array<A>> = new Right(new Array<A>());

      return (jsonObject as Array<string>).reduce((either, string) =>
          either.flatMap(array =>
            this.codec.decode(string).map(a => {
              array.push(a)
              return array
            }),
          )
        , startingValue)
    })
  }
}

const Codecs = {
  number: new PrimitiveCodec<number>(),
  object: new PrimitiveCodec<Object>(),
  date: new DateCodec(),
}

abstract class Optional<A> {
  static apply<A>(value: A | null | undefined): Optional<A> {
    if (value === undefined || value === null) {
      return None.instance
    } else {
      return new Some(value)
    }
  }

  /**
   * Creates an option from a string by calling parseInt on it and the returned number is a NaN or infinite returns None otherwise Some of the number
   */
  static parseInt(string: string): Optional<number> {
    const number = parseInt(string)
    if (isNaN(number) || !isFinite(number)) {
      return None.instance
    } else {
      return new Some(number)
    }
  }

  static parseFloat(string: string): Optional<number> {
    const number = parseFloat(string)
    if (isNaN(number) || !isFinite(number)) {
      return None.instance
    } else {
      return new Some(number)
    }
  }

  abstract get get(): A

  abstract get isEmpty(): Boolean

  get nonEmpty(): Boolean {
    return !this.isEmpty
  }

  orElse(alternative: Optional<A>): Optional<A> {
    if (this.isEmpty) {
      return alternative
    } else {
      return this
    }
  }

  getOrElse(ifEmpty: () => A): A {
    if (this.isEmpty) {
      return ifEmpty()
    } else {
      return this.get
    }
  }

  getOrThrow(message: string): A {
    if (this.isEmpty) {
      throw new Error(message)
    } else {
      return this.get
    }
  }

  get orNull(): A | null {
    if (this.isEmpty) {
      return null
    } else {
      return this.get
    }
  }

  map<B>(f: (a: A) => B): Optional<B> {
    if (this.isEmpty) {
      return None.instance
    } else {
      return new Some<B>(f(this.get))
    }
  }

  flatMap<B>(f: (a: A) => Optional<B>): Optional<B> {
    if (this.isEmpty) {
      return None.instance
    } else {
      return f(this.get)
    }
  }

  flatApply<B>(f: (a: A) => B | null | undefined): Optional<B> {
    return this.flatMap(a => Optional.apply(f(a)))
  }

  tap(f: (a: A) => any): Optional<A> {
    if (this.isEmpty) {
      return None.instance
    } else {
      f(this.get)
      return this
    }
  }

  collect<B>(f: (a: A) => B | undefined): Optional<B> {
    if (this.isEmpty) {
      return None.instance
    } else {
      try {
        const value = f(this.get)
        return Optional.apply(value)
      } catch (e) {
        return None.instance
      }
    }
  }

  flatCollect<B>(f: (a: A) => Optional<B> | undefined): Optional<B> {
    if (this.isEmpty) {
      return None.instance
    } else {
      try {
        const b = f(this.get)
        if (b === undefined) {
          return None.instance
        } else {
          return b
        }
      } catch (e) {
        return None.instance
      }
    }
  }

  fold<B>(ifEmpty: B, f: (a: A) => B): B {
    return this.cata(() => ifEmpty, f)
  }

  cata<B>(ifEmpty: () => B, f: (a: A) => B): B {
    if (this.isEmpty) {
      return ifEmpty()
    } else {
      return f(this.get)
    }
  }

  filter(p: (a: A) => Boolean): Optional<A> {
    if (this.isEmpty || p(this.get)) {
      return this
    } else {
      return None.instance
    }
  }

  filterNot(p: (a: A) => Boolean): Optional<A> {
    if (this.isEmpty || !p(this.get)) {
      return this
    } else {
      return None.instance
    }
  }

  contains(a: A): Boolean {
    return !this.isEmpty && this.get === a
  }

  exists(p: (a: A) => Boolean): Boolean {
    return !this.isEmpty && p(this.get)
  }

  forall(p: (a: A) => Boolean): Boolean {
    return this.isEmpty || p(this.get)
  }

  zip<B>(that: Optional<B>): Optional<[A, B]> {
    if (this.isEmpty || that.isEmpty) {
      return None.instance
    } else {
      return new Some([this.get, that.get])
    }
  }

  toLeft<B>(right: B): Either<A, B> {
    if (this.isEmpty) {
      return new Right(right)
    } else {
      return new Left(this.get)
    }
  }

  toRight<B>(left: B): Either<B, A> {
    if (this.isEmpty) {
      return new Left(left)
    } else {
      return new Right(this.get)
    }
  }

  toPromise(failureReason: string): Promise<A> {
    if (this.isEmpty) {
      return Promise.reject<A>(failureReason)
    } else {
      return Promise.resolve(this.get)
    }
  }

  static when<A>(p: Boolean, a: () => A): Optional<A> {
    if (p) {
      return new Some(a())
    } else {
      return None.instance
    }
  }

  static unless<A>(p: Boolean, a: () => A): Optional<A> {
    return Optional.when(!p, a)
  }

  /**
   * This writes None as null and other values uses the given encoder
   * @param encoder
   */
  static encoder<A>(encoder: Encoder<A>): Encoder<Optional<A>> {
    class OptionalEncoder implements Encoder<Optional<A>> {
      encode(a: Optional<A>): Object {
        return a.fold("null", encoder.encode)
      }
    }

    return new OptionalEncoder()
  }

  /**
   * This decodes nulls to None and other values to Some
   * @param decoder
   */
  static decoder<A>(decoder: Decoder<A>): Decoder<Optional<A>> {
    class OptionalDecoder implements Decoder<Optional<A>> {
      decode(json: Object): Result<Optional<A>> {
        if (json === "null") {
          return new Right<string, Optional<A>>(None.instance)
        } else {
          return decoder.decode(json).map(a => new Some(a))
        }
      }
    }

    return new OptionalDecoder()
  }

  static codec<A>(codec: Codec<A>): Codec<Optional<A>> {
    class OptionalCodec implements Codec<Optional<A>> {
      encode(a: Optional<A>): Object {
        return Optional.encoder(codec).encode(a)
      }

      decode(json: Object): Result<Optional<A>> {
        return Optional.decoder(codec).decode(json)
      }

    }

    return new OptionalCodec()
  }

  static sequence<A>(options: Array<Optional<A>>): Optional<Array<A>> {
    return options.reduce((acc, o) => acc.flatMap(array => {
      return o.map(ov => {
        array.push(ov)
        return array
      })
    }), new Some(new Array<A>()))
  }
}

class Some<A> extends Optional<A> {
  value: A

  constructor(value: A) {
    super()
    this.value = value
  }

  get isEmpty(): Boolean {
    return false
  }

  get get(): A {
    return this.value
  }
}

class None extends Optional<never> {
  private static existingInstance = new None()

  private constructor() {
    super()
  }

  static get instance(): None {
    return this.existingInstance
  }

  get isEmpty(): Boolean {
    return true
  }

  get get(): never {
    throw new Error("Trying to get value of None!")
  }
}

abstract class Either<A, B> {
  abstract get isRight(): Boolean

  abstract get isLeft(): Boolean

  private get right(): Right<A, B> {
    if (this.isLeft) {
      throw new Error("Trying to cast Left as Right!")
    } else {
      return this as unknown as Right<A, B>
    }
  }

  private get left(): Left<A, B> {
    if (this.isRight) {
      throw new Error("Trying to cast Right as Left!")
    } else {
      return this as unknown as Left<A, B>
    }
  }

  get get(): B {
    if (this.isLeft) {
      throw this.left.value
    } else {
      return this.right.value
    }
  }

  getOrElse(def: B): B {
    if (this.isLeft) {
      return def
    } else {
      return this.right.value
    }
  }

  get toOption(): Optional<B> {
    if (this.isLeft) {
      return None.instance
    } else {
      return new Some<B>(this.right.value)
    }
  }


  map<C>(f: (a: B) => C): Either<A, C> {
    if (this.isLeft) {
      return this as unknown as Either<A, C>
    } else {
      return new Right<A, C>(f(this.right.value))
    }
  }

  flatMap<C extends A, D>(f: (b: B) => Either<C, D>): Either<C, D> {
    if (this.isLeft) {
      return this as unknown as Either<C, D>
    } else {
      return f(this.right.value)
    }
  }

  fold<C>(f: (a: A) => C, g: (b: B) => C): C {
    if (this.isLeft) {
      return f(this.left.value)
    } else {
      return g(this.right.value)
    }
  }

  get toPromise(): Promise<B> {
    if (this.isLeft) {
      return Promise.reject<B>(this.left.value)
    } else {
      return Promise.resolve(this.right.value)
    }
  }
}

class Left<A, B> extends Either<A, B> {
  value: A

  constructor(value: A) {
    super()
    this.value = value
  }

  get isRight(): Boolean {
    return false
  }

  get isLeft(): Boolean {
    return true
  }
}

class Right<A, B> extends Either<A, B> {
  value: B

  constructor(value: B) {
    super()
    this.value = value
  }

  get isRight(): Boolean {
    return true
  }

  get isLeft(): Boolean {
    return false
  }
}

interface HashCodeAndEquals {
  hashCode(): number

  equals(o: this): boolean
}

class Entry<K, V> {
  readonly key: K
  value: V

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

abstract class HashMap<K, V> {
  abstract add(key: K, value: V): HashMap<K,V>
  abstract delete(key: K): HashMap<K,V>
  abstract get(key: K): Optional<V>
  abstract get entries(): Array<Entry<K, V>>

  abstract get create(): HashMap<K,V>

  get keys(): Array<K> {
    return this.entries.map(entry => entry.key)
  }

  get values(): Array<V> {
    return this.entries.map(entry => entry.value)
  }

  fold<B>(zero: B, op: (acc: B, key: K, value: V) => B) {
    return this.entries.reduce<B>((acc: B, entry: Entry<K, V>) => op(acc, entry.key, entry.value), zero)
  }

  getOrElse(key: K, defaultValue: () => V) {
    return this.get(key).getOrElse(defaultValue);
  }

  filterKeys(predicate): HashMap<K,V> {
    return this.fold(this.create, (acc, key, value) => {
      if (predicate(key)) {
        acc.add(key, value);
      }
      return acc;
    })
  }
}

class MutableHashMap<K, V> extends HashMap<K,V> {
  private readonly fill: number
  private maxSize: number
  private size: number = 0
  private buckets: Array<Array<Entry<K, V>>>
  private readonly hashCode: (k: K) => number
  private readonly equals: (o1: K, o2: K) => Boolean
  private threshold

  private constructor(
    hashCode: (k: K) => number,
    equals: (o1: K, o2: K) => Boolean,
    maxSize: number = 16,
    fill: number = 0.75,
  ) {
    super()
    this.hashCode = hashCode
    this.equals = equals
    this.maxSize = maxSize;
    this.fill = fill;
    this.buckets = new Array(maxSize);
    this.threshold = this.maxSize * this.fill
  }

  static apply<KH extends HashCodeAndEquals, V>() {
    return new MutableHashMap<KH, V>(
      (k: KH) => k.hashCode(),
      (o1: KH, o2: KH) => o1.equals(o2),
    )
  }

  static applyWithHashCodeAndEquals<K, V>(
    hashCode: (k: K) => number,
    equals: (o1: K, o2: K) => Boolean,
  ) {
    return new MutableHashMap<K, V>(hashCode, equals)
  }

  get create(): HashMap<K,V> {
    return new MutableHashMap<K, V>(this.hashCode, this.equals)
  }

  private hash(key: K): number {
    const hashCode = Math.abs(this.hashCode(key));
    return hashCode % this.maxSize
  }

  private addEntry(entry: Entry<K, V>): void {
    const bucketID = this.hash(entry.key)
    const bucket = this.buckets[bucketID]

    if (bucket === undefined) {
      this.buckets[bucketID] = [entry]
      this.size++
    } else {
      function pushEntry() {
        bucket.push(entry)
        return 1
      }

      this.size += Optional.apply(bucket.find(e => this.equals(entry.key, e.key)))
        .cata<number>(pushEntry, e => {
          e.value = entry.value
          return 0
        })
    }
  }

  private increaseMaxSize() {
    this.maxSize *= 2
    this.threshold = this.maxSize * this.fill
    this.size = 0
    const entries = this.buckets.flat()
    this.buckets = new Array(this.maxSize)
    entries.forEach(entry => this.addEntry(entry))
  }

  add(key: K, value: V): HashMap<K, V> {
    const bucketID = this.hash(key)
    const bucket = this.buckets[bucketID]

    if (bucket === undefined) {
      this.buckets[bucketID] = [new Entry(key, value)]
      this.size++
    } else {
      const increase = Optional.apply(bucket.find(entry => this.equals(key, entry.key)))
        .cata(
          () => {
            bucket.push(new Entry(key, value))
            return 1
          },
          entry => {
            entry.value = value
            return 0
          },
        )
      this.size += increase
    }
    if (this.size > this.threshold) {
      this.increaseMaxSize()
    }
    return this
  }

  get(key: K): Optional<V> {
    const bucketID = this.hash(key) % this.maxSize
    return Optional.apply(this.buckets[bucketID])
      .flatApply(bucket => bucket.find(entry => this.equals(key, entry.key)))
      .map(entry => entry.value)
  }

  delete(key: K): HashMap<K, V> {
    const bucketID = this.hash(key) % this.maxSize
    Optional.apply(this.buckets[bucketID])
      .map(bucket => {
        this.buckets[bucketID] = bucket.filter(entry => !this.equals(key, entry.key))
        this.size--
      })
    return this
  }

  get entries(): Array<Entry<K, V>> {
    return this.buckets.flat()
  }

  get clone(): MutableHashMap<K, V> {
    const map: MutableHashMap<K, V> = new MutableHashMap(this.hashCode, this.equals)
    this.entries.forEach(entry => map.add(entry.key, entry.value))
    return map
  }
}

class ImmutableHashMap<K, V> extends HashMap<K, V> {
  private readonly innerMap: MutableHashMap<K, V>

  constructor(innerMap: MutableHashMap<K, V>) {
    super()
    this.innerMap = innerMap
  }

  static apply<KH extends HashCodeAndEquals, V>() {
    return new ImmutableHashMap(MutableHashMap.apply<KH, V>())
  }

  static applyWithHashCodeAndEquals<K, V>(
    hashCode: (k: K) => number,
    equals: (o1: K, o2: K) => Boolean,
  ) {
    return new ImmutableHashMap(MutableHashMap.applyWithHashCodeAndEquals<K, V>(hashCode, equals))
  }

  private cloneAndOP(f: (map: MutableHashMap<K, V>) => HashMap<K, V>): ImmutableHashMap<K, V> {
    return new ImmutableHashMap<K, V>(f(this.innerMap.clone) as MutableHashMap<K, V>)
  }

  add(key: K, value: V): HashMap<K, V> {
    return this.cloneAndOP(map => map.add(key, value))
  }

  delete(key: K): HashMap<K, V> {
    return this.cloneAndOP(map => map.delete(key))
  }

  get entries(): Array<Entry<K, V>> {
    return this.innerMap.entries
  }

  get(key: K): Optional<V> {
    return this.innerMap.get(key)
  }

  get create(): HashMap<K, V> {
    return this.innerMap.create;
  }
}

/*abstract class BetterArray<A> {
  [index: number]: A;

  private get values(): Array<A> {
    return Object.keys(this).map(prop => this[prop])
  }
  find(p: (a: A) => Boolean): Optional<A> {
    return Optional.apply(this.values.find(p))
  }
}*/

/*class List<A> {
  readonly values: Array<A>

  constructor(values: Array<A> = new Array<A>()) {
    this.values = values;
  }

  get length() {
    return this.values.length
  }

  add(a: A) {
    this.values.push(a)
  }

  find(p: (a: A) => boolean): Optional<A> {
    return Optional.apply(this.values.find(p))
  }

  map<B>(f: (a: A) => B): List<B> {
    return new List<B>(this.values.map(f))
  }


}*/

function identity<T>(t: T): T {
  return t
}

function stringHashcode(string) {
  return [...string/*.slice(0, string.length >> 1)*/].reduce((acc, char) => {
    //return 31 * acc + char.charCodeAt(0)
    return (acc << 5) - acc + char.charCodeAt(0)
  }, 0) | 0
}

function instanceEquals<A>(o1: A, o2: A) {
  return o1 === o2
}

function daysSince(date: Date) {
  return (new Date().getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
}

function html(literals, ...vars) {
  let raw = literals.raw,
    result = "",
    i = 1,
    len = arguments.length,
    str,
    variable

  while (i < len) {
    str = raw[i - 1]
    variable = vars[i - 1]
    result += str + variable
    i++
  }
  result += raw[raw.length - 1]

  return $.parseHTML(result)[0]
}

async function get(link: string): Promise<JQuery> {
  const result = await new Promise<HTMLElement>(resolve => $.get(link, resolve))
  return $(result)
}

async function getWithData(link: string, data: Object): Promise<JQuery> {
  const result = await new Promise<HTMLElement>(resolve => $.get(link, data, resolve))
  return $(result)
}

/************************************************ Models **************************************************************/

class Entity implements HashCodeAndEquals {
  readonly id: number
  readonly name: string
  readonly metalCost: number
  readonly crystalCost: number
  readonly deuteriumCost: number

  constructor(id: number, name: string, metalCost: number, crystalCost: number, deuteriumCost: number) {
    this.id = id
    this.name = name
    this.metalCost = metalCost
    this.crystalCost = crystalCost
    this.deuteriumCost = deuteriumCost
  }

  equals(o: Entity): boolean {
    return this.id === o.id;
  }

  hashCode(): number {
    let hash = 7;
    hash = 31 * hash + this.metalCost;
    hash = 31 * hash + this.crystalCost;
    hash = 31 * hash + this.deuteriumCost;
    hash = 31 * hash + this.id;
    return hash;
  }
}

class Ship extends Entity {
  private readonly innerCapacity: number

  constructor(id: number, name: string, metalCost: number, crystalCost: number, deuteriumCost: number, capacity: number) {
    super(id, name, metalCost, crystalCost, deuteriumCost)
    this.innerCapacity = capacity
  }

  get capacity(): number {
    return this.innerCapacity * (1 + 0.05 * spyHelper.settings.hyperspaceTechnologyLevel)
  }

  static fromName(shipName: string): Optional<Ship> {
    switch (shipName) {
      case LIGHT_FIGHTER.name:
        return new Some(LIGHT_FIGHTER)
      case HEAVY_FIGHTER.name:
        return new Some(HEAVY_FIGHTER)
      case CRUISER.name:
        return new Some(CRUISER)
      case BATTLESHIP.name:
        return new Some(BATTLESHIP)
      case BATTLECRUISER.name:
        return new Some(BATTLECRUISER)
      case BOMBER.name:
        return new Some(BOMBER)
      case DESTROYER.name:
        return new Some(DESTROYER)
      case DEATHSTAR.name:
        return new Some(DEATHSTAR)
      case REAPER.name:
        return new Some(REAPER)
      case PATHFINDER.name:
        return new Some(PATHFINDER)
      case SMALL_CARGO.name:
        return new Some(SMALL_CARGO)
      case LARGE_CARGO.name:
        return new Some(LARGE_CARGO)
      case COLONY_SHIP.name:
        return new Some(COLONY_SHIP)
      case RECYCLER.name:
        return new Some(RECYCLER)
      case ESPIONAGE_PROBE.name:
        return new Some(ESPIONAGE_PROBE)
      case SOLAR_SATELLITE.name:
        return new Some(SOLAR_SATELLITE)
      case CRAWLER.name:
        return new Some(CRAWLER)
      default:
        return None.instance
      //throw `Could not find a Ship named ${shipName}`
    }
  }
}

class Defence extends Entity {
  readonly structuralIntegrity: number
  readonly shield: number
  readonly damage: number

  constructor(id: number, name: string, metalCost: number, crystalCost: number, deuteriumCost: number, structuralIntegrity: number, shield: number, damage: number) {
    super(id, name, metalCost, crystalCost, deuteriumCost)
    this.structuralIntegrity = structuralIntegrity
    this.shield = shield
    this.damage = damage
  }

  static fromName(defenceName: string): Optional<Defence> {
    switch (defenceName) {
      case ROCKET_LAUNCHER.name:
        return new Some(ROCKET_LAUNCHER)
      case LIGHT_LASER.name:
        return new Some(LIGHT_LASER)
      case HEAVY_LASER.name:
        return new Some(HEAVY_LASER)
      case GAUSS_CANNON.name:
        return new Some(GAUSS_CANNON)
      case ION_CANNON.name:
        return new Some(ION_CANNON)
      case PLASMA_TURRET.name:
        return new Some(PLASMA_TURRET)
      case SMALL_SHIELD_DOME.name:
        return new Some(SMALL_SHIELD_DOME)
      case LARGE_SHIELD_DOME.name:
        return new Some(LARGE_SHIELD_DOME)
      case ANTI_BALLISTIC_MISSILES.name:
        return new Some(ANTI_BALLISTIC_MISSILES)
      case INTERPLANETARY_MISSILES.name:
        return new Some(INTERPLANETARY_MISSILES)
      default:
        return None.instance
      //throw `Could not find a Defence named ${defenceName}`
    }
  }

  get defenceScore(): number {
    return (this.structuralIntegrity / 10 + this.shield * 6 + this.damage * 6) / 1000
  }
}

class Missile extends Defence {
  constructor(id: number, name: string, metalCost: number, crystalCost: number, deuteriumCost: number, structuralIntegrity: number, shield: number, damage: number) {
    super(id, name, metalCost, crystalCost, deuteriumCost, structuralIntegrity, shield, damage)
  }

  get defenceScore(): number {
    return 0
  }
}

class Building extends Entity {
  constructor(id: number, name: string) {
    super(id, name, 0, 0, 0)
  }

  static fromName(buildingName: string): Optional<Building> {
    switch (buildingName) {
      case METAL_MINE.name:
        return new Some(METAL_MINE)
      case METAL_STORAGE.name:
        return new Some(METAL_STORAGE)
      case CRYSTAL_MINE.name:
        return new Some(CRYSTAL_MINE)
      case CRYSTAL_STORAGE.name:
        return new Some(CRYSTAL_STORAGE)
      case DEUTERIUM_SYNTHESIZER.name:
        return new Some(DEUTERIUM_SYNTHESIZER)
      case DEUTERIUM_TANK.name:
        return new Some(DEUTERIUM_TANK)
      case SOLAR_PLANT.name:
        return new Some(SOLAR_PLANT)
      case FUSION_REACTOR.name:
        return new Some(FUSION_REACTOR)
      case ROBOTICS_FACTORY.name:
        return new Some(ROBOTICS_FACTORY)
      case NANITE_FACTORY.name:
        return new Some(NANITE_FACTORY)
      case SHIPYARD.name:
        return new Some(SHIPYARD)
      case SPACE_DOCK.name:
        return new Some(SPACE_DOCK)
      case MISSILE_SILO.name:
        return new Some(MISSILE_SILO)
      case RESEARCH_LAB.name:
        return new Some(RESEARCH_LAB)
      case ALLIANCE_DEPOT.name:
        return new Some(ALLIANCE_DEPOT)
      case TERRAFORMER.name:
        return new Some(TERRAFORMER)
      case LUNAR_BASE.name:
        return new Some(LUNAR_BASE)
      case SENSOR_PHALANX.name:
        return new Some(SENSOR_PHALANX)
      case JUMP_GATE.name:
        return new Some(JUMP_GATE)
      default:
        return None.instance
      //throw `Could not find a Building named ${buildingName}`
    }
  }
}

class StorageBuilding extends Building {

  constructor(id: number, name: string) {
    super(id, name)
  }

  /**
   * @returns {number}
   */
  maximum(level: number): number {
    return 5000 * Math.floor(2.5 * Math.pow(Math.E, 20 * level / 33))
  }
}

class MetalMine extends Building {

  constructor() {
    super(1, "Metal Mine")
  }

  hourlyProduction(level: number, plasmaTechnologyLevel: number): number {
    const universeSpeed = spyHelper.universeProperties.speed
    return Math.floor(30 * level * Math.pow(1.1, level) * (1 + 0.01 * plasmaTechnologyLevel / 100) * universeSpeed) + 30 * universeSpeed
  }
}

class CrystalMine extends Building {

  constructor() {
    super(2, "Crystal Mine")
  }

  hourlyProduction(level: number, plasmaTechnologyLevel: number): number {
    const universeSpeed = spyHelper.universeProperties.speed
    return Math.floor(20 * level * Math.pow(1.1, level) * (1 + 2 * plasmaTechnologyLevel / 300) * universeSpeed) + 15 * universeSpeed
  }
}

class DeuteriumSynthesizer extends Building {

  constructor() {
    super(3, "Deuterium Synthesizer")
  }

  hourlyProduction(level: number, planetPosition: number): number {
    const universeSpeed = spyHelper.universeProperties.speed
    return (10 * level * 1.1 ^ level) * (1.36 - 0.004 * AVERAGE_TEMP[planetPosition]) * universeSpeed
  }
}

class Research extends Entity {
  constructor(id: number, name: string, metalCost: number, crystalCost: number, deuteriumCost: number) {
    super(id, name, metalCost, crystalCost, deuteriumCost)
  }

  static fromName(researchName: string) {
    switch (researchName) {
      case ENERGY_TECHNOLOGY.name:
        return new Some(ENERGY_TECHNOLOGY)
      case LASER_TECHNOLOGY.name:
        return new Some(LASER_TECHNOLOGY)
      case ION_TECHNOLOGY.name:
        return new Some(ION_TECHNOLOGY)
      case HYPERSPACE_TECHNOLOGY.name:
        return new Some(HYPERSPACE_TECHNOLOGY)
      case PLASMA_TECHNOLOGY.name:
        return new Some(PLASMA_TECHNOLOGY)
      case ESPIONAGE_TECHNOLOGY.name:
        return new Some(ESPIONAGE_TECHNOLOGY)
      case COMPUTER_TECHNOLOGY.name:
        return new Some(COMPUTER_TECHNOLOGY)
      case ASTROPHYSICS.name:
        return new Some(ASTROPHYSICS)
      case INTERGALACTIC_RESEARCH_NETWORK.name:
        return new Some(INTERGALACTIC_RESEARCH_NETWORK)
      case GRAVITON_TECHNOLOGY.name:
        return new Some(GRAVITON_TECHNOLOGY)
      case COMBUSTION_DRIVE.name:
        return new Some(COMBUSTION_DRIVE)
      case IMPULSE_DRIVE.name:
        return new Some(IMPULSE_DRIVE)
      case HYPERSPACE_DRIVE.name:
        return new Some(HYPERSPACE_DRIVE)
      case WEAPONS_TECHNOLOGY.name:
        return new Some(WEAPONS_TECHNOLOGY)
      case SHIELDING_TECHNOLOGY.name:
        return new Some(SHIELDING_TECHNOLOGY)
      case ARMOUR_TECHNOLOGY.name:
        return new Some(ARMOUR_TECHNOLOGY)
      default:
        return None.instance
      //throw `Could not find a Research named ${researchName}`
    }
  }
}

class Class {
  readonly name: string
  readonly productionMultiplier: number
  readonly color: string

  constructor(name: string, productionMultiplier: number, color: string) {
    this.name = name
    this.productionMultiplier = productionMultiplier
    this.color = color
  }

  static fromName(className: string): Optional<Class> {
    switch (className) {
      case GENERAL.name:
        return new Some(GENERAL)
      case COLLECTOR.name:
        return new Some(COLLECTOR)
      case DISCOVERER.name:
        return new Some(DISCOVERER)
      case NO_CLASS.name:
        return new Some(NO_CLASS)
      default:
        return None.instance
    }
  }
}

//region Combat Ships
const LIGHT_FIGHTER = new Ship(204, "Light Fighter", 3000, 1000, 0, 50)
const HEAVY_FIGHTER = new Ship(205, "Heavy Fighter", 6000, 4000, 0, 100)
const CRUISER = new Ship(206, "Cruiser", 20000, 7000, 2000, 800)
const BATTLESHIP = new Ship(207, "Battleship", 45000, 15000, 0, 1500)
const BATTLECRUISER = new Ship(215, "Battlecruiser", 30000, 40000, 15000, 750)
const BOMBER = new Ship(211, "Bomber", 50000, 25000, 15000, 500)
const DESTROYER = new Ship(213, "Destroyer", 60000, 50000, 15000, 2000)
const DEATHSTAR = new Ship(214, "Deathstar", 5e6, 4e6, 1e6, 1e6)
const REAPER = new Ship(218, "Reaper", 85000, 55000, 20000, 10000)
const PATHFINDER = new Ship(219, "Pathfinder", 8000, 15000, 8000, 10000)
//endregion
//region Civil Ships
const SMALL_CARGO = new Ship(202, "Small Cargo", 2000, 2000, 0, 5000)
const LARGE_CARGO = new Ship(203, "Large Cargo", 6000, 6000, 0, 25000)
const COLONY_SHIP = new Ship(208, "Colony Ship", 10000, 20000, 10000, 7500)
const RECYCLER = new Ship(209, "Recycler", 10000, 6000, 2000, 20000)
const ESPIONAGE_PROBE = new Ship(210, "Espionage Probe", 0, 1000, 0, 0)
const SOLAR_SATELLITE = new Ship(212, "Solar Satellite", 0, 2000, 500, 0)
const CRAWLER = new Ship(217, "Crawler", 2000, 2000, 1000, 0)
//endregion
//region Defences
const ROCKET_LAUNCHER = new Defence(401, "Rocket Launcher", 2000, 0, 0, 2000, 20, 80)
const LIGHT_LASER = new Defence(402, "Light Laser", 1500, 500, 0, 2000, 25, 100)
const HEAVY_LASER = new Defence(403, "Heavy Laser", 6000, 2000, 0, 8000, 100, 250)
const GAUSS_CANNON = new Defence(404, "Gauss Cannon", 20000, 15000, 2000, 35000, 200, 1100)
const ION_CANNON = new Defence(405, "Ion Cannon", 2000, 6000, 0, 8000, 500, 150)
const PLASMA_TURRET = new Defence(406, "Plasma Turret", 50000, 50000, 15000, 100000, 300, 3000)
const SMALL_SHIELD_DOME = new Defence(407, "Small Shield Dome", 10000, 10000, 0, 20000, 2000, 1)
const LARGE_SHIELD_DOME = new Defence(408, "Large Shield Dome", 50000, 50000, 0, 100000, 10000, 1)
//endregion
//region Missiles
const ANTI_BALLISTIC_MISSILES = new Missile(502, "Anti-Ballistic Missiles", 8000, 0, 2000, 8000, 1, 1)
const INTERPLANETARY_MISSILES = new Missile(503, "Interplanetary Missiles", 12500, 2500, 10000, 15000, 1, 12000)
//endregion
//region Buildings
const METAL_MINE = new MetalMine()
const METAL_STORAGE = new StorageBuilding(22, "Metal Storage")
const CRYSTAL_MINE = new CrystalMine()
const CRYSTAL_STORAGE = new StorageBuilding(23, "Crystal Storage")
const DEUTERIUM_SYNTHESIZER = new DeuteriumSynthesizer()
const DEUTERIUM_TANK = new StorageBuilding(24, "Deuterium Tank")
const SOLAR_PLANT = new Building(4, "Solar Plant")
const FUSION_REACTOR = new Building(12, "Fusion Reactor")
const ROBOTICS_FACTORY = new Building(14, "Robotics Factory")
const NANITE_FACTORY = new Building(15, "Nanite Factory")
const SHIPYARD = new Building(21, "Shipyard")
const SPACE_DOCK = new Building(36, "Space Dock")
const MISSILE_SILO = new Building(44, "Missile Silo")
const RESEARCH_LAB = new Building(31, "Research Lab")
const ALLIANCE_DEPOT = new Building(34, "Alliance Depot")
const TERRAFORMER = new Building(33, "Terraformer")
const LUNAR_BASE = new Building(41, "Lunar Base")
const SENSOR_PHALANX = new Building(42, "Sensor Phalanx")
const JUMP_GATE = new Building(43, "Jump Gate")
//endregion
//region Researches
const ENERGY_TECHNOLOGY = new Research(113, "Energy Technology", 0, 800, 400)
const LASER_TECHNOLOGY = new Research(120, "Laser Technology", 200, 100, 0)
const ION_TECHNOLOGY = new Research(121, "Ion Technology", 100, 300, 100)
const HYPERSPACE_TECHNOLOGY = new Research(114, "Hyperspace Technology", 0, 4000, 2000)
const PLASMA_TECHNOLOGY = new Research(122, "Plasma Technology", 2000, 4000, 1000)
const ESPIONAGE_TECHNOLOGY = new Research(106, "Espionage Technology", 200, 1000, 200)
const COMPUTER_TECHNOLOGY = new Research(108, "Computer Technology", 0, 400, 600)
const ASTROPHYSICS = new Research(124, "Astrophysics", 4000, 8000, 4000)
const INTERGALACTIC_RESEARCH_NETWORK = new Research(123, "Intergalactic Research Network", 240000, 400000, 160000)
const GRAVITON_TECHNOLOGY = new Research(199, "Graviton Technology", 0, 0, 0)
const COMBUSTION_DRIVE = new Research(115, "Combustion Drive", 400, 0, 600)
const IMPULSE_DRIVE = new Research(117, "Impulse Drive", 2000, 4000, 600)
const HYPERSPACE_DRIVE = new Research(118, "Hyperspace Drive", 10000, 20000, 6000)
const WEAPONS_TECHNOLOGY = new Research(109, "Weapons Technology", 800, 200, 0)
const SHIELDING_TECHNOLOGY = new Research(110, "Shielding Technology", 200, 600, 0)
const ARMOUR_TECHNOLOGY = new Research(111, "Armour Technology", 1000, 0, 0)
//endregion
//region Classes
const COLLECTOR = new Class("Collector", 1.25, "orange")
const GENERAL = new Class("General", 1, "red")
const DISCOVERER = new Class("Discoverer", 1, "blue")
const NO_CLASS = new Class("No class selected", 1, "")

//endregion

function parseTextNumber(string): Optional<number> {
  return Optional.apply(/\D*((\d+\.?)+)/g.exec(string))
    .flatMap(regex => Optional.parseInt(regex[1].replace(/[^0-9]+/g, "")))
}

class UniverseProperties {
  readonly speed: number
  readonly fleetSpeed: number
  readonly debrisRatio: number
  readonly debrisRatioDefence: number

  constructor(speed: number, fleetSpeed: number, debrisRatio: number, debrisRatioDefence: number) {
    this.speed = speed
    this.fleetSpeed = fleetSpeed
    this.debrisRatio = debrisRatio
    this.debrisRatioDefence = debrisRatioDefence
  }

  static async get(): Promise<UniverseProperties> {
    const result = await get(`https://${UNIVERSE}/api/serverData.xml`)
    function getProperty(name: string): Promise<number> {
      return Optional.apply(result.find(name).get(0).textContent).flatMap(Optional.parseFloat)
        .toPromise(`Failed to get ${name} from universe settings XML`)
    }
    return new UniverseProperties(
      await getProperty("speed"),
      await getProperty("speedFleet"),
      await getProperty("debrisFactor"),
      await getProperty("debrisFactorDef"),
    )
  }
}

abstract class Storable {
  static load<A>(saveName: string, decoder: Decoder<A>): Result<A> {
    return Optional.apply(localStorage.getItem(saveName))
      .map(JSON.parse)
      .toRight(`Could not find ${saveName} in storage!`)
      .flatMap(json => decoder.decode(json))
  }

  save(saveName: string, encoder: Encoder<this>): void {
    const json = JSON.stringify(encoder.encode(this));
    if (json === null) {
      localStorage.removeItem(saveName)
    } else {
      localStorage.setItem(saveName, json)
    }
  }
}

class Coordinates implements HashCodeAndEquals {
  readonly galaxy: number
  readonly system: number
  readonly position: number

  constructor(galaxy: number, system: number, position: number) {
    this.galaxy = galaxy
    this.system = system
    this.position = position
  }

  print(): string {
    return `${this.galaxy}:${this.system}:${this.position}`
  }

  hashCode(): number {
    let hash = 7;
    hash = 31 * hash + this.galaxy;
    hash = 31 * hash + this.system;
    hash = 31 * hash + this.position;
    return hash;
  }

  /**
   * Extracts coordinates from text in the format galaxy:system:planet
   * @param text text with the coordinates
   * @returns {Coordinates}
   */
  static fromText(text: string): Optional<Coordinates> {
    return Optional.sequence(text.split(":").map(Optional.parseInt))
      .map(coords => {
        const [galaxy, system, position] = coords
        return new Coordinates(galaxy, system, position)
      })
    //Using string split is faster than using regex, regex is about 35% slower
    /*return Optional.apply(/(?<galaxy>\d):(?<system>\d+):(?<position>\d+)/g.exec(text))
      .flatApply(match => match.groups)
      .map(matchGroups => new Coordinates(Optional.parseInt(matchGroups.galaxy).get, Optional.parseInt(matchGroups.system).get, Optional.parseInt(matchGroups.position).get))*/
  }

  equals(other: Coordinates) {
    return this.galaxy === other.galaxy && this.system === other.system && this.position === other.position
  }

  static get codec(): Codec<Coordinates> {
    class CoordinatesCodec implements Codec<Coordinates> {
      encode(a: Coordinates): Object {
        return Codecs.object.encode({
          galaxy: a.galaxy,
          system: a.system,
          position: a.position,
        })
      }

      decode(json: Object): Result<Coordinates> {
        return Codecs.object.decode(json).map(jsonObject => {
          const json = jsonObject as {
            galaxy: number,
            system: number,
            position: number
          }
          return new Coordinates(json.galaxy, json.system, json.position)
        })
      }
    }

    return new CoordinatesCodec()
  }
}

class CoordinatesWithType extends Coordinates {
  readonly bodyType: CelestialBodyType

  constructor(galaxy: number, system: number, position: number, celestialType: CelestialBodyType) {
    super(galaxy, system, position)
    this.bodyType = celestialType
  }

  static fromTitle(title: JQuery): Optional<CoordinatesWithType> {
    const anchor = title.find("a")
    return Optional.apply((title.find("a").get(0) as HTMLAnchorElement).textContent)
      .flatApply(text => /(?<galaxy>\d+):(?<system>\d+):(?<position>\d+)/g.exec(text))
      .flatMap(match => {
        const groups = match.groups as {
          galaxy: string,
          system: string,
          position: string,
        }

        let celestialBodyType = CelestialBodyType.PLANET
        if (anchor.find("figure").get(0).classList.contains("moon")) {
          celestialBodyType = CelestialBodyType.MOON
        }

        return Optional.parseInt(groups.galaxy).flatMap(galaxy =>
          Optional.parseInt(groups.system).flatMap(system =>
            Optional.parseInt(groups.position).map(position =>
              new CoordinatesWithType(galaxy, system, position, celestialBodyType)
            )
          )
        )
      })
  }

  static fromIcon(icon: JQuery): Optional<CoordinatesWithType> {
    return Optional.apply(icon.get(0).parentNode)
      .map(node => (node as HTMLAnchorElement).href)
      .flatApply(href => /galaxy=(?<galaxy>\d+)&system=(?<system>\d+)&position=(?<position>\d+)&type=(?<type>\d+)/g.exec(href))
      .flatMap(match => {
        const groups = match.groups as {
          galaxy: string,
          system: string,
          position: string,
          type: string
        }

        return Optional.parseInt(groups.galaxy).flatMap(galaxy =>
          Optional.parseInt(groups.system).flatMap(system =>
            Optional.parseInt(groups.position).flatMap(position =>
              Optional.parseInt(groups.type).map(celestialBodyFromID).map(type =>
                new CoordinatesWithType(galaxy, system, position, type)
              )
            )
          )
        )
      })
  }

  static fromReport(report: JQuery): Optional<CoordinatesWithType> {
    return CoordinatesWithType.fromIcon(report.find(".icon_attack"))
      .orElse(CoordinatesWithType.fromTitle(report.find(".msg_title.blue_txt")))
  }
}

class Debris {
  readonly metal: number
  readonly crystal: number

  constructor(metal: number, crystal: number) {
    this.metal = metal;
    this.crystal = crystal;
  }

  get total() {
    return this.metal + this.crystal
  }

  add(other: Debris): Debris {
    return new Debris(this.metal + other.metal, this.crystal + other.crystal)
  }

  /**
   * Calculates the debris of destroy the given entities using the given debrisFactor
   */
  static calculateFor(entities: HashMap<Entity, number>, debrisFactor: number) {
    return entities.fold(new Debris(0, 0), (totalDebris, entity, amount) => {
      const debrisAmount = debrisFactor * amount
      return totalDebris.add(new Debris(debrisAmount * entity.metalCost, debrisAmount * entity.crystalCost))
    })
  }

  static get codec(): Codec<Debris> {
    class DebrisCodec implements Codec<Debris> {
      encode(a: Debris): Object {
        return Codecs.object.encode({
          metal: a.metal,
          crystal: a.crystal,
        })
      }

      decode(json: Object): Result<Debris> {
        return Codecs.object.decode(json).map(jsonObject => {
          const json = jsonObject as {
            metal: number,
            crystal: number,
          }
          return new Debris(json.metal, json.crystal)
        })
      }
    }

    return new DebrisCodec()
  }
}

class Resources extends Debris {
  readonly deuterium: number

  constructor(metal: number, crystal: number, deuterium: number) {
    super(metal, crystal);
    this.deuterium = deuterium;
  }

  get total() {
    return this.metal + this.crystal + this.deuterium
  }

  static get codec(): Codec<Resources> {
    class ResourcesCodec implements Codec<Resources> {
      encode(a: Resources): Object {
        return Codecs.object.encode({
          metal: a.metal,
          crystal: a.crystal,
          deuterium: a.deuterium,
        })
      }

      decode(json: Object): Result<Resources> {
        return Codecs.object.decode(json).map(jsonObject => {
          const json = jsonObject as {
            metal: number,
            crystal: number,
            deuterium: number,
          }
          return new Resources(json.metal, json.crystal, json.deuterium)
        })
      }
    }

    return new ResourcesCodec()
  }
}

class ResourcesWithEnergy extends Resources {
  readonly energy: number

  constructor(metal: number, crystal: number, deuterium: number, energy: number) {
    super(metal, crystal, deuterium);
    this.energy = energy;
  }

  static get codec(): Codec<ResourcesWithEnergy> {
    class ResourcesWithEnergyCodec implements Codec<ResourcesWithEnergy> {
      encode(a: ResourcesWithEnergy): Object {
        return Codecs.object.encode({
          metal: a.metal,
          crystal: a.crystal,
          deuterium: a.deuterium,
          energy: a.energy,
        })
      }

      decode(json: Object): Result<ResourcesWithEnergy> {
        return Codecs.object.decode(json).map(jsonObject => {
          const json = jsonObject as {
            metal: number,
            crystal: number,
            deuterium: number,
            energy: number,
          }
          return new ResourcesWithEnergy(json.metal, json.crystal, json.deuterium, json.energy)
        })
      }
    }

    return new ResourcesWithEnergyCodec()
  }
}

abstract class Section {
  readonly date: Date

  constructor(date: Date) {
    this.date = date;
  }

  static getMostUpToDate<A extends Section>(old: Optional<A>, recent: Optional<A>): Optional<A> {
    if (old.nonEmpty && recent.nonEmpty && recent.get.date > old.get.date) {
      return recent
    } else {
      return old.orElse(recent)
    }
  }
}

abstract class SectionWithEntities<A extends Entity> extends Section {
  readonly all: HashMap<A, number>

  constructor(all: HashMap<A, number>, date: Date) {
    super(date);
    this.all = all;
  }

  static sectionFromReport<E extends Entity, Section>(
    report: JQuery,
    date: Date,
    sectionID: string,
    fromName: (name: string) => Optional<E>,
    section: new (all: HashMap<E, number>, date: Date) => Section,
  ): Optional<Section> {
    const detailAtId = $(report.find(`[data-type="${sectionID}"]`))
    return Optional.when($(detailAtId).find(".detail_list_fail").length === 0, () => {
      const all = detailAtId.find(".detail_list_el").toArray().reduce((acc, element) => {
        const name = $(element).find(".detail_list_txt").get(0).innerHTML
        const entity = fromName(name).getOrThrow(`Could not find entity with name ${name}`)
        const amount = parseTextNumber($(element).find(".fright").get(0).innerHTML)
          .getOrThrow(`Could not find amount for ${name}`)
        acc.add(entity, amount)
        return acc
      }, ImmutableHashMap.apply<E, number>())
      return new section(all, date)
    })
  }

  get tooltipText() {
    return this.all.fold("", (acc, entity, amount) => `${acc}${entity.name}: ${amount}<br />`)

  }

  private amount(what: Entity) {
    return this.all.getOrElse(what as A, () => 0)
  }

  amountOf(what: Ship | Defence) {
    return this.amount(what)
  }

  levelOf(what: Building | Research) {
    return this.amount(what)
  }

  protected static innerCodec<A extends Entity, Section extends SectionWithEntities<A>>(
    fromName: (name: string) => Optional<A>,
    section: new (all: ImmutableHashMap<A, number>, date: Date) => Section,
  ): Codec<Section> {
    class SectionWithEntitiesCodec implements Codec<Section> {
      encode(a: Section): Object {
        return Codecs.object.encode({
          all: a.all.fold({}, (acc, thing, amount) => {
            acc[thing.name] = amount
            return acc
          }),
          date: Codecs.date.encode(a.date),
        })
      }

      decode(json: Object): Result<Section> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            all: Object,
            date: string,
          }
          const thingMap = ImmutableHashMap.apply<A, number>()
          for (const name in json.all) {
            if (json.all.hasOwnProperty(name)) {
              const amount = json[name]
              if (Number.isInteger(amount) && amount > 0) {
                const thingType = fromName(name).getOrThrow(`Could not find ${name}`)
                thingMap.add(thingType, amount)
              }
            }
          }
          return Codecs.date.decode(json.date).map(date => new section(thingMap, date))
        })
      }
    }

    return new SectionWithEntitiesCodec()
  }
}

class ResourcesSection extends Section {
  readonly resources: ResourcesWithEnergy
  readonly plunderRatio: number

  constructor(resources: ResourcesWithEnergy, plunderRatio: number, date: Date) {
    super(date)
    this.resources = resources
    this.plunderRatio = plunderRatio
  }

  get metal(): number {
    return this.resources.metal
  }

  get crystal(): number {
    return this.resources.crystal
  }

  get deuterium(): number {
    return this.resources.deuterium
  }

  get energy(): number {
    return this.resources.energy
  }

  get total(): number {
    return this.resources.total
  }

  get metalPlunder(): number {
    return this.metal * this.plunderRatio
  }

  get crystalPlunder(): number {
    return this.crystal * this.plunderRatio
  }

  get deuteriumPlunder(): number {
    return this.deuterium * this.plunderRatio
  }

  get totalPlunder(): number {
    return this.total * this.plunderRatio
  }

  static fromDetailedReport(details: JQuery, plunderRatio: number, date: Date) {
    const resources = $(details.find(`[data-type="resources"]`).get(0))
      .find(".resource_list_el")
      .toArray()
      .reduce((acc, element, id) => {
        acc[id] = parseTextNumber(element.title).get
        return acc
      }, {})

    //TODO: Add date
    return new ResourcesSection(
      new ResourcesWithEnergy(
        resources[0],
        resources[1],
        resources[2],
        resources[3],
      ),
      plunderRatio,
      date,
    )
  }

  print() {
    return `metal: ${this.metal}, crystal: ${this.crystal}, deuterium: ${this.deuterium}, plunderRatio: ${this.plunderRatio}`
  }

  static codec(resourcesCodec: Codec<ResourcesWithEnergy> = ResourcesWithEnergy.codec): Codec<ResourcesSection> {
    class ResourcesSectionCodec implements Codec<ResourcesSection> {
      encode(a: ResourcesSection): Object {
        return Codecs.object.encode({
          resources: resourcesCodec.encode(a.resources),
          plunderRatio: a.plunderRatio,
          date: Codecs.date.encode(a.date),
        })
      }

      decode(json: Object): Result<ResourcesSection> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            resources: string,
            plunderRatio: number,
            date: string,
          }
          return resourcesCodec.decode(json.resources).flatMap(resources =>
            Codecs.date.decode(json.date).map(date =>
              new ResourcesSection(resources, json.plunderRatio, date),
            ),
          )
        })
      }
    }

    return new ResourcesSectionCodec()
  }
}

class DebrisSection extends Section {
  readonly debris: Debris

  constructor(debris: Debris, date: Date) {
    super(date);
    this.debris = debris;
  }

  get metal() {
    return this.debris.metal
  }

  get crystal() {
    return this.debris.crystal
  }

  get total() {
    return this.debris.total
  }

  static fromDetailedReport(details: JQuery, date: Date): Optional<DebrisSection> {
    const resourceSections = details.find(`[data-type="resources"]`)
    if (resourceSections.length === 2) {
      const resources = $(resourceSections.get(1))
        .find(".resource_list_el")
        .toArray()
        .reduce((acc, element, id) => {
          acc[id] = parseTextNumber(element.title)
          return acc
        }, {})

      return new Some(new DebrisSection(
        new Debris(
          resources[0],
          resources[1],
        ),
        date,
      ))
    } else {
      return None.instance
    }
  }

  static codec(debrisCodec: Codec<Debris> = Debris.codec): Codec<DebrisSection> {
    class DebrisSectionCodec implements Codec<DebrisSection> {
      encode(a: DebrisSection): Object {
        return Codecs.object.encode({
          debris: debrisCodec.encode(a.debris),
          date: Codecs.date.encode(a.date),
        })
      }

      decode(json: Object): Result<DebrisSection> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            debris: string,
            date: string,
          }
          return debrisCodec.decode(json.debris).flatMap(debris =>
            Codecs.date.decode(json.date).map(date =>
              new DebrisSection(debris, date),
            ),
          )
        })
      }
    }

    return new DebrisSectionCodec()
  }
}

class Fleets extends SectionWithEntities<Ship> {
  constructor(ships: HashMap<Ship, number>, date: Date) {
    super(ships, date)
  }

  static fromDetailedReport(report: JQuery, reportDate): Optional<Fleets> {
    return SectionWithEntities.sectionFromReport(report, reportDate, FLEET_SECTION, Ship.fromName, Fleets)
  }

  get debris(): Debris {
    return Debris.calculateFor(this.all, spyHelper.universeProperties.debrisRatio)
  }

  static get codec() {
    return Fleets.innerCodec(Ship.fromName, Fleets)
  }
}

class Defences extends SectionWithEntities<Defence> {
  constructor(defences: HashMap<Defence, number>, date: Date) {
    super(defences, date)
  }

  static fromDetailedReport(report: JQuery, reportDate): Optional<Defences> {
    return SectionWithEntities.sectionFromReport(report, reportDate, DEFENCES_SECTION, Defence.fromName, Defences)
  }

  private get noMissiles(): HashMap<Defence, number> {
    return this.all.filterKeys(defence => !(defence instanceof Missile))
  }

  get debris(): Debris {
    return Debris.calculateFor(this.noMissiles, spyHelper.universeProperties.debrisRatioDefence)
  }

  get score() {
    return this.all
      .fold(0, (acc, defense, amount) => {
        return acc + defense.defenceScore * amount
      })
  }

  static get codec() {
    return Defences.innerCodec(Defence.fromName, Defences)
  }
}

class Buildings extends SectionWithEntities<Building> {
  constructor(buildings: HashMap<Building, number>, date: Date) {
    super(buildings, date)
  }

  static fromDetailedReport(report: JQuery, reportDate): Optional<Buildings> {
    return SectionWithEntities.sectionFromReport(report, reportDate, BUILDINGS_SECTION, Building.fromName, Buildings)
  }

  production(planetResources: ResourcesWithEnergy, reportDate: Date, researches: Optional<Researches>, coordinates: Coordinates, planetType: number, clazz: Class) {
    if (planetType !== CelestialBodyType.PLANET) {
      return new Resources(0, 0, 0)
    }
    let plasmaTechnologyLevel = researches.fold(0, researches => researches.levelOf(PLASMA_TECHNOLOGY))
    const maxMetal = METAL_STORAGE.maximum(this.levelOf(METAL_STORAGE))
    const metalProduction = METAL_MINE.hourlyProduction(this.levelOf(METAL_MINE), plasmaTechnologyLevel) * clazz.productionMultiplier

    const maxCrystal = CRYSTAL_STORAGE.maximum(this.levelOf(CRYSTAL_STORAGE))
    const crystalProduction = CRYSTAL_MINE.hourlyProduction(this.levelOf(CRYSTAL_MINE), plasmaTechnologyLevel) * clazz.productionMultiplier

    const maxDeuterium = DEUTERIUM_TANK.maximum(this.levelOf(DEUTERIUM_TANK))
    const deuteriumProduction = DEUTERIUM_SYNTHESIZER.hourlyProduction(this.levelOf(DEUTERIUM_SYNTHESIZER), coordinates.position) * clazz.productionMultiplier

    const deltaHours = (Date.now() - reportDate.getTime()) / 3.6e6

    const totalMetal = Math.max(Math.min(maxMetal - planetResources.metal, metalProduction * deltaHours), 0)
    const totalCrystal = Math.max(Math.min(maxCrystal - planetResources.crystal, crystalProduction * deltaHours), 0)
    const totalDeuterium = Math.max(Math.min(maxDeuterium - planetResources.deuterium, deuteriumProduction * deltaHours), 0)
    return new Resources(totalMetal, totalCrystal, totalDeuterium)
  }

  static get codec() {
    return Buildings.innerCodec(Building.fromName, Buildings)
  }
}

class Researches extends SectionWithEntities<Research> {
  constructor(researches: HashMap<Research, number>, date: Date) {
    super(researches, date)
  }

  static fromDetailedReport(report: JQuery, reportDate): Optional<Researches> {
    return SectionWithEntities.sectionFromReport(report, reportDate, RESEARCHES_SECTION, Research.fromName, Researches)
  }

  static get codec() {
    return Researches.innerCodec(Research.fromName, Researches)
  }
}

class Message {
  readonly id: number
  readonly date: Date

  constructor(id: number, date: Date) {
    this.id = id;
    this.date = date;
  }
}

class ParsedReport extends Message {
  readonly resources: ResourcesSection
  readonly existingDebris: Optional<DebrisSection>
  readonly fleets: Optional<Fleets>
  readonly defences: Optional<Defences>
  readonly buildings: Optional<Buildings>
  readonly researches: Optional<Researches>

  constructor(id: number, date: Date, resources: ResourcesSection, existingDebris: Optional<DebrisSection>, fleets: Optional<Fleets>, defences: Optional<Defences>, buildings: Optional<Buildings>, researches: Optional<Researches>) {
    super(id, date)
    this.resources = resources;
    this.existingDebris = existingDebris;
    this.fleets = fleets;
    this.defences = defences;
    this.buildings = buildings;
    this.researches = researches;
  }

  static fromDetailedReport(message: Message, report: JQuery, plunderRatio: number): ParsedReport {
    const id = message.id
    const date = message.date
    const resources = ResourcesSection.fromDetailedReport(report, plunderRatio, date)
    const existingDebris = DebrisSection.fromDetailedReport(report, date)
    const fleets = Fleets.fromDetailedReport(report, date)
    const defences = Defences.fromDetailedReport(report, date)
    const buildings = Buildings.fromDetailedReport(report, date)
    const researches = Researches.fromDetailedReport(report, date)
    return new ParsedReport(id, date, resources, existingDebris, fleets, defences, buildings, researches)
  }

  static codec(
    resourcesCodec: Codec<ResourcesSection> = ResourcesSection.codec(),
    debrisSectionCodec: Codec<DebrisSection> = DebrisSection.codec(),
    fleetsCodec: Codec<Fleets> = Fleets.codec,
    defencesCodec: Codec<Defences> = Defences.codec,
    buildingsCodec: Codec<Buildings> = Buildings.codec,
    researchesCodec: Codec<Researches> = Researches.codec,
  ): Codec<ParsedReport> {
    const optionalDebrisSectionCodec: Codec<Optional<DebrisSection>> = Optional.codec(debrisSectionCodec)
    const optionalFleetsCodec: Codec<Optional<Fleets>> = Optional.codec(fleetsCodec)
    const optionalDefencesCodec: Codec<Optional<Defences>> = Optional.codec(defencesCodec)
    const optionalBuildingsCodec: Codec<Optional<Buildings>> = Optional.codec(buildingsCodec)
    const optionalResearchesCodec: Codec<Optional<Researches>> = Optional.codec(researchesCodec)

    class ParsedReportCodec implements Codec<ParsedReport> {
      encode(a: ParsedReport): Object {
        return Codecs.object.encode({
          id: a.id,
          date: Codecs.date.encode(a.date),
          resources: resourcesCodec.encode(a.resources),
          existingDebris: optionalDebrisSectionCodec.encode(a.existingDebris),
          fleets: optionalFleetsCodec.encode(a.fleets),
          defences: optionalDefencesCodec.encode(a.defences),
          buildings: optionalBuildingsCodec.encode(a.buildings),
          researches: optionalResearchesCodec.encode(a.researches),
        })
      }

      decode(json: Object): Result<ParsedReport> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            id: number,
            date: string,
            resources: string,
            existingDebris: string,
            fleets: string,
            defences: string,
            buildings: string,
            researches: string,
          }

          return Codecs.date.decode(json.date).flatMap(date =>
            resourcesCodec.decode(json.resources).flatMap(resources =>
              optionalDebrisSectionCodec.decode(json.existingDebris).flatMap(existingDebris =>
                optionalFleetsCodec.decode(json.fleets).flatMap(fleets =>
                  optionalDefencesCodec.decode(json.defences).flatMap(defences =>
                    optionalBuildingsCodec.decode(json.buildings).flatMap(buildings =>
                      optionalResearchesCodec.decode(json.researches).map(researches =>
                        new ParsedReport(json.id, date, resources, existingDebris, fleets, defences, buildings, researches),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        })
      }
    }

    return new ParsedReportCodec()
  }
}

enum Direction {
  Up = -1,
  Down = 1,
}

class Settings extends Storable {
  researches: Optional<Researches>
  defaultProbes: number
  readonly lastSortKey: string
  readonly lastSortOrder: Direction

  private constructor(researches: Optional<Researches> = None.instance, defaultProbes: number = 1, lastSortKey: string = "date", lastSortOrder: Direction = Direction.Up) {
    super()
    this.researches = researches
    this.defaultProbes = defaultProbes
    this.lastSortKey = lastSortKey
    this.lastSortOrder = lastSortOrder
  }

  copy({
         researches = this.researches,
         defaultProbes = this.defaultProbes,
         lastSortKey = this.lastSortKey,
         lastSortOrder = this.lastSortOrder,
       } = {}): Settings {
    return new Settings(researches, defaultProbes, lastSortKey, lastSortOrder);
  }

  get combustionDriveLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(COMBUSTION_DRIVE))
  }

  get impulseDriveLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(IMPULSE_DRIVE))
  }

  get hyperspaceDriveLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(HYPERSPACE_DRIVE))
  }

  get weaponsTechnologyLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(WEAPONS_TECHNOLOGY))
  }

  get shieldingTechnologyLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(SHIELDING_TECHNOLOGY))
  }

  get armourTechnologyLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(ARMOUR_TECHNOLOGY))
  }

  get hyperspaceTechnologyLevel(): number {
    return this.researches.fold(0, researches => researches.levelOf(HYPERSPACE_TECHNOLOGY))
  }

  updateResearch(): void {
    function getResearch(research: Research) {
      return Optional.apply($($(`[data-technology=${research.id}]`).find(".level").get(0)).attr("data-value"))
        .flatMap(Optional.parseInt)
        .getOrElse(() => 0)
    }

    const researches = ImmutableHashMap.apply<Research, number>()
    researches.add(ENERGY_TECHNOLOGY, getResearch(ENERGY_TECHNOLOGY))
    researches.add(LASER_TECHNOLOGY, getResearch(LASER_TECHNOLOGY))
    researches.add(ION_TECHNOLOGY, getResearch(ION_TECHNOLOGY))
    researches.add(HYPERSPACE_TECHNOLOGY, getResearch(HYPERSPACE_TECHNOLOGY))
    researches.add(PLASMA_TECHNOLOGY, getResearch(PLASMA_TECHNOLOGY))
    researches.add(ESPIONAGE_TECHNOLOGY, getResearch(ESPIONAGE_TECHNOLOGY))
    researches.add(COMPUTER_TECHNOLOGY, getResearch(COMPUTER_TECHNOLOGY))
    researches.add(ASTROPHYSICS, getResearch(ASTROPHYSICS))
    researches.add(INTERGALACTIC_RESEARCH_NETWORK, getResearch(INTERGALACTIC_RESEARCH_NETWORK))
    researches.add(GRAVITON_TECHNOLOGY, getResearch(GRAVITON_TECHNOLOGY))
    researches.add(COMBUSTION_DRIVE, getResearch(COMBUSTION_DRIVE))
    researches.add(IMPULSE_DRIVE, getResearch(IMPULSE_DRIVE))
    researches.add(HYPERSPACE_DRIVE, getResearch(HYPERSPACE_DRIVE))
    researches.add(WEAPONS_TECHNOLOGY, getResearch(WEAPONS_TECHNOLOGY))
    researches.add(SHIELDING_TECHNOLOGY, getResearch(SHIELDING_TECHNOLOGY))
    researches.add(ARMOUR_TECHNOLOGY, getResearch(ARMOUR_TECHNOLOGY))

    this.researches = new Some(new Researches(researches, new Date()))
    this.saveToLocalStorage()
    console.log("Updated researches")
  }

  updateDefaultProbes() {
    // @ts-ignore
    this.defaultProbes = window.spionageAmount
    this.saveToLocalStorage()
    console.log("Updated default probes sent")
  }

  private static get saveName() {
    return `${SAVE_NAME_PREFIX}_settings`
  }

  static codec(researchesCodec: Codec<Researches> = Researches.codec): Codec<Settings> {
    const optionalResearchesCodec = Optional.codec<Researches>(researchesCodec)

    class SettingsCodec implements Codec<Settings> {
      encode(a: Settings): Object {
        return Codecs.object.encode({
          researches: optionalResearchesCodec.encode(a.researches),
          defaultProbes: a.defaultProbes,
          lastSortKey: a.lastSortKey,
          lastSortOrder: a.lastSortOrder,
        })
      }

      decode(json: Object): Result<Settings> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            researches: string,
            defaultProbes: number,
            lastSortKey: string,
            lastSortOrder: Direction,
          }

          return optionalResearchesCodec.decode(json.researches).map(researches =>
            new Settings(researches, json.defaultProbes, json.lastSortKey, json.lastSortOrder),
          )
        })
      }
    }

    return new SettingsCodec()
  }

  static loadFromLocalStorage(): Settings {
    return this.load(Settings.saveName, Settings.codec()).getOrElse(new Settings())
  }

  saveToLocalStorage() {
    this.save(Settings.saveName, Settings.codec())
  }
}

class Player {
  readonly id: number
  readonly name: string
  readonly planets: Set<number>
  readonly researches: Optional<Researches>

  constructor(id: number, name: string, planets: Set<number> = new Set<number>(), researches: Optional<Researches> = None.instance) {
    this.id = id;
    this.name = name;
    this.planets = planets;
    this.researches = researches;
  }

  copy({
         id = this.id,
         name = this.name,
         planets = this.planets,
         researches = this.researches,
       } = {}) {
    return new Player(id, name, planets, researches);
  }

  static codec(
    researchesCodec: Codec<Researches> = Researches.codec,
  ): Codec<Player> {
    const optionalResearchesCodec = Optional.codec<Researches>(researchesCodec)

    class PlayerCodec implements Codec<Player> {
      encode(a: Player): Object {
        return Codecs.object.encode({
          id: a.id,
          name: a.name,
          planets: a.planets,
          researches: optionalResearchesCodec.encode(a.researches),
        })
      }

      decode(json: Object): Result<Player> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            id: number,
            name: string,
            planets: Set<number>,
            researches: string,
          }

          return optionalResearchesCodec.decode(json.researches).map(researches =>
            new Player(json.id, json.name, json.planets, researches),
          )
        })
      }
    }

    return new PlayerCodec()
  }
}

class CelestialBody implements HashCodeAndEquals {
  readonly id: number
  readonly coordinates: Coordinates
  readonly buildings: Optional<Buildings>
  readonly defences: Optional<Defences>

  constructor(id: number, coordinates: Coordinates, buildings: Optional<Buildings>, defences: Optional<Defences>) {
    this.id = id;
    this.coordinates = coordinates;
    this.buildings = buildings;
    this.defences = defences;
  }

  equals(o: this): boolean {
    return this.id == o.id;
  }

  hashCode(): number {
    return this.id;
  }
}

class Moon extends CelestialBody {
  readonly size: Optional<number>

  constructor(id: number, coordinates: Coordinates, buildings: Optional<Buildings>, defences: Optional<Defences>, size: Optional<number> = None.instance) {
    super(id, coordinates, buildings, defences);
    this.size = size;
  }

  copy({
         id = this.id,
         coordinates = this.coordinates,
         buildings = this.buildings,
         defences = this.defences,
         size = this.size,
       } = {}) {
    return new Moon(id, coordinates, buildings, defences, size);
  }

  static codec(
    coordinatesCodec: Codec<Coordinates> = Coordinates.codec,
    buildingsCodec: Codec<Buildings> = Buildings.codec,
    defencesCodec: Codec<Defences> = Defences.codec,
  ): Codec<Moon> {
    const optionalNumberCodec = Optional.codec(Codecs.number)
    const optionalBuildingsCodec = Optional.codec(buildingsCodec)
    const optionalDefencesCodec = Optional.codec(defencesCodec)

    class MoonCodec implements Codec<Moon> {
      encode(a: Moon): Object {
        return Codecs.object.encode({
          id: a.id,
          coordinates: coordinatesCodec.encode(a.coordinates),
          buildings: optionalBuildingsCodec.encode(a.buildings),
          defences: optionalDefencesCodec.encode(a.defences),
          size: optionalNumberCodec.encode(a.size),
        })
      }

      decode(json: Object): Result<Moon> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            id: number,
            coordinates: string,
            buildings: string,
            defences: string,
            size: string,
          }

          return coordinatesCodec.decode(json.coordinates).flatMap(coordinates =>
            optionalBuildingsCodec.decode(json.buildings).flatMap(buildings =>
              optionalDefencesCodec.decode(json.defences).flatMap(defences =>
                optionalNumberCodec.decode(json.size).map(size =>
                  new Moon(json.id, coordinates, buildings, defences, size),
                ),
              ),
            ),
          )
        })
      }
    }

    return new MoonCodec()
  }
}

class Planet extends CelestialBody implements HashCodeAndEquals {
  readonly moonId: Optional<number>

  constructor(id: number, coordinates: Coordinates, buildings: Optional<Buildings> = None.instance, defences: Optional<Defences> = None.instance, moonId: Optional<number> = None.instance) {
    super(id, coordinates, buildings, defences);
    this.moonId = moonId;
  }

  copy({
         id = this.id,
         coordinates = this.coordinates,
         buildings = this.buildings,
         defences = this.defences,
         moonId = this.moonId,
       } = {}) {
    return new Planet(id, coordinates, buildings, defences, moonId);
  }

  static codec(
    coordinatesCodec: Codec<Coordinates> = Coordinates.codec,
    buildingsCodec: Codec<Buildings> = Buildings.codec,
    defencesCodec: Codec<Defences> = Defences.codec,
  ): Codec<Planet> {
    const optionalNumberCodec = Optional.codec(Codecs.number)
    const optionalBuildingsCodec = Optional.codec(buildingsCodec)
    const optionalDefencesCodec = Optional.codec(defencesCodec)

    class PlanetCodec implements Codec<Planet> {
      encode(a: Planet): Object {
        return Codecs.object.encode({
          id: a.id,
          coordinates: coordinatesCodec.encode(a.coordinates),
          buildings: optionalBuildingsCodec.encode(a.buildings),
          defences: optionalDefencesCodec.encode(a.defences),
          moonId: optionalNumberCodec.encode(a.moonId),
        })
      }

      decode(json: Object): Result<Planet> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            id: number,
            coordinates: string,
            buildings: string,
            defences: string,
            moonId: string,
          }

          return coordinatesCodec.decode(json.coordinates).flatMap(coordinates =>
            optionalBuildingsCodec.decode(json.buildings).flatMap(buildings =>
              optionalDefencesCodec.decode(json.defences).flatMap(defences =>
                optionalNumberCodec.decode(json.moonId).map(moonId =>
                  new Planet(json.id, coordinates, buildings, defences, moonId),
                ),
              ),
            ),
          )
        })
      }
    }

    return new PlanetCodec()
  }
}

class Universe extends Storable {
  playersAPIDate: Optional<Date>
  universeAPIDate: Optional<Date>
  private readonly players: HashMap<number, Player>
  private readonly planets: HashMap<number, Planet>
  private readonly moons: HashMap<number, Moon>

  //Helper maps for easier access
  private readonly playersByName: HashMap<string, Player> = ImmutableHashMap.applyWithHashCodeAndEquals(stringHashcode, instanceEquals)
  private readonly planetsByCoordinates: HashMap<Coordinates, Planet> = ImmutableHashMap.apply()
  private readonly moonsByCoordinates: HashMap<Coordinates, Moon> = ImmutableHashMap.apply()

  private constructor(
    playersAPIDate: Optional<Date> = None.instance,
    universeAPIDate: Optional<Date> = None.instance,
    players: HashMap<number, Player> = ImmutableHashMap.applyWithHashCodeAndEquals(identity, instanceEquals),
    planets: HashMap<number, Planet> = ImmutableHashMap.applyWithHashCodeAndEquals(identity, instanceEquals),
    moons: HashMap<number, Moon> = ImmutableHashMap.applyWithHashCodeAndEquals(identity, instanceEquals),
  ) {
    super();
    this.playersAPIDate = playersAPIDate;
    this.universeAPIDate = universeAPIDate;
    this.players = players;
    this.planets = planets;
    this.moons = moons;

    players.values.forEach(player => {
      this.playersByName.add(player.name, player)
    })

    planets.values.forEach(planet => {
      this.planetsByCoordinates.add(planet.coordinates, planet)
    })

    moons.values.forEach(moon => {
      this.moonsByCoordinates.add(moon.coordinates, moon)
    })
  }

  addPlayer(player: Player) {
    this.players.add(player.id, player)
    this.playersByName.add(player.name, player)
    return player
  }

  addPlanet(planet: Planet) {
    this.planets.add(planet.id, planet)
    this.planetsByCoordinates.add(planet.coordinates, planet)
    return planet
  }

  addMoon(moon: Moon) {
    this.moons.add(moon.id, moon)
    this.moonsByCoordinates.add(moon.coordinates, moon)
    return moon
  }

  /**
   * Updates a planet assuming IDs do not change
   */
  private updatePlayerWithSameID(player: Player) {
    const oldPlayer = this.players.get(player.id).getOrThrow(`Could not find player with id ${player.id}`)
    this.players.delete(oldPlayer.id)
    this.playersByName.delete(oldPlayer.name)
    return this.addPlayer(player)
  }

  /**
   * Updates a planet assuming IDs do not change
   */
  private updatePlanetWithSameID(planet: Planet) {
    const oldPlayer = this.planets.get(planet.id).getOrThrow(`Could not find planet with id ${planet.id}`)
    this.planets.delete(oldPlayer.id)
    this.planetsByCoordinates.delete(oldPlayer.coordinates)
    return this.addPlanet(planet)
  }

  /**
   * Updates a moon assuming IDs do not change
   */
  private updateMoonWithSameID(moon: Moon) {
    const oldMoon = this.moons.get(moon.id).getOrThrow(`Could not find moon with id ${moon.id}`)
    this.moons.delete(oldMoon.id)
    this.moonsByCoordinates.delete(oldMoon.coordinates)
    return this.addMoon(moon)
  }

  findPlayerByID(id: number): Optional<Player> {
    return this.players.get(id)
    //return Optional.apply(Array.from(this.players.values).find(player => player.id === id))
  }

  findPlanetByID(id: number): Optional<Planet> {
    return this.planets.get(id)
    //return Optional.apply(this.planets.values.find(planet => planet.id === id))
  }

  findMoonByID(id: number): Optional<Moon> {
    return this.moons.get(id)
    //return Optional.apply(Array.from(this.moons.values).find(moon => moon.id === id))
  }

  /**
   * Updates the player name if it differs from the given name
   */
  private updatePlayerName(player: Player, name: string): Player {
    if (player.name != name) {
      return this.updatePlayerWithSameID(player.copy({name: name}))
    } else {
      return player
    }
  }

  private addPlayerIfNotExists(id: number, name: string): Player {
    return this.players.getOrElse(id, () => this.addPlayer(new Player(id, name, new Set<number>(), None.instance))
    )
  }

  addPlayerOrUpdateName(id: number, name: string): Player {
    const player = this.addPlayerIfNotExists(id, name)
    return this.updatePlayerName(player, name)
  }

  addPlanetToPlayer(playerID: number, planet: Planet): void {
    this.findPlayerByID(playerID)
      .map(player => {
        this.updatePlayerWithSameID(player.copy({
          planets: player.planets.add(planet.id),
        }))
      })
  }

  /**
   * Moves a moon to the given coordinates.
   */
  private moveMoon(moon: Moon, targetCoordinates: Coordinates): Moon {
    return this.updateMoonWithSameID(moon.copy({coordinates: targetCoordinates}))
  }

  /**
   * Moves a planet and its moon to the given coordinates.
   */
  private movePlanet(planet: Planet, targetCoordinates: Coordinates): Planet {
    const updatedPlanet = planet.copy({coordinates: targetCoordinates})
    updatedPlanet.moonId.map(moonId => {
      const moonById = this.findMoonByID(moonId).getOrThrow(`Unable to find moon with ID: ${moonId}`)
      this.moveMoon(moonById, targetCoordinates)
    })
    return this.updatePlanetWithSameID(updatedPlanet)
  }


  private addPlanetIfNotExists(id: number, coordinates: Coordinates, moon: Optional<Moon>): Planet {
    return this.planets.getOrElse(id, () => this.addPlanet(new Planet(id, coordinates, None.instance, None.instance, moon.map(moon => moon.id))))
  }

  updatePlanetWithId(id: number, coordinates: Coordinates, moon: Optional<Moon>): Planet {
    let planet = this.addPlanetIfNotExists(id, coordinates, moon)
    if (planet.coordinates != coordinates) {
      planet = this.movePlanet(planet, coordinates)
    }
    if (planet.moonId.isEmpty) {
      planet = this.updatePlanetWithSameID(planet.copy({
        moonId: moon.map(moon => moon.id),
      }))
    }
    return planet
  }

  private addMoonIfNotExists(id: number, coordinates: Coordinates, size: Optional<number> = None.instance): Moon {
    return this.moons.getOrElse(id, () => this.addMoon(new Moon(id, coordinates, None.instance, None.instance, size)))
  }

  //sdads

  setNewCoordinatesForMoon(id: number, coordinates: Coordinates, size: Optional<number> = None.instance): Moon {
    const moon = this.addMoonIfNotExists(id, coordinates, size)
    return this.updateMoonWithSameID(moon.copy({
      coordinates: coordinates,
      size: moon.size.orElse(size),
    }))
  }

  updateMoon(planet: HTMLElement, coordinates: Coordinates): Optional<Moon> {
    return Optional.apply(planet.children[0])
      .map(moon => {
        const id = Optional.parseInt(moon.id).get
        const size = Optional.apply($(moon).attr("size")).map(parseInt)
        return this.setNewCoordinatesForMoon(id, coordinates, size)
      })
  }

  private async updatePlanetsAndMoons(): Promise<void> {
    if (this.universeAPIDate.forall(date => daysSince(date) > 7)) {
      console.log("Updating universe")
      const result = await get(`https://${UNIVERSE}/api/universe.xml`)
      const universe = result.find("universe")
      universe.find("planet").toArray().forEach((planet, index) => {
        const planet$: JQuery = $(planet)
        const coordinates = Optional.apply(planet$.attr("coords"))
          .flatMap(Coordinates.fromText)
          .getOrThrow("Could not get coordinates in updatePlanetsAndMoons!")
        const moon = this.updateMoon(planet, coordinates)
        const id = Optional.parseInt(planet.id).get
        //console.log(`Updating planet ${id} at ${coordinates.print()}`)
        const updatedPlanet = this.updatePlanetWithId(id, coordinates, moon)
        const playerID = Optional.apply(planet$.attr("player")).map(parseInt)
          .getOrThrow("Could not get player ID in updatePlanetsAndMoons!")
        this.addPlanetToPlayer(playerID, updatedPlanet)
      })
      this.universeAPIDate = Optional.apply(universe.attr("timestamp"))
        .flatMap(Optional.parseInt)
        .map(timestamp => new Date(timestamp * 1000))
    } else {
      return Promise.resolve()
    }
  }

  private async updatePlayers(): Promise<void> {
    if (this.playersAPIDate.forall(date => daysSince(date) > 1)) {
      console.log("Updating players")
      const link = `https://${UNIVERSE}/api/players.xml`

      const result = await get(link)
      const players = result.find("players")
      players.find("player").toArray().map(player => {
        const id = Optional.parseInt(player.id).get
        const name = Optional.apply($(player).attr("name")).getOrThrow("Could not get player name in updatePlayers")
        this.addPlayerOrUpdateName(id, name)
      })
      this.playersAPIDate = Optional.apply(players.attr("timestamp"))
        .flatMap(Optional.parseInt)
        .map(timestamp => new Date(timestamp * 1000))
      console.log("Players update finished")
    } else {
      return Promise.resolve()
    }
  }

  async updateEverything(): Promise<void> {
    await this.updatePlayers()
    await this.updatePlanetsAndMoons()
    this.saveToLocalStorage()
  }

  updatePlanetAt(coordinates: Coordinates, buildings: Optional<Buildings>, defences: Optional<Defences>): Optional<Planet> {
    return this.planetsByCoordinates.get(coordinates).map(planet => {
      const updatedBuildings = Section.getMostUpToDate(planet.buildings, buildings)
      const updatedDefences = Section.getMostUpToDate(planet.defences, defences)
      const updatedPlanet = planet.copy({
        buildings: updatedBuildings,
        defences: updatedDefences,
      })
      this.addPlanet(updatedPlanet)
      return updatedPlanet
    })
  }

  updateMoonAt(coordinates: Coordinates, buildings: Optional<Buildings>, defences: Optional<Defences>): Optional<Moon> {
    return this.moonsByCoordinates.get(coordinates).map(moon => {
      const updatedBuildings = Section.getMostUpToDate(moon.buildings, buildings)
      const updatedDefences = Section.getMostUpToDate(moon.defences, defences)
      const updatedMoon = moon.copy({
        buildings: updatedBuildings,
        defences: updatedDefences,
      })
      this.addMoon(updatedMoon)
      return updatedMoon
    })
  }

  updatePlayerResearchesByName(name: string, researches: Optional<Researches>): Optional<Player> {
    return this.playersByName.get(name).map(player => {
      const updatedResearches = Section.getMostUpToDate(player.researches, researches)
      const updatedPlayer = player.copy({
        researches: updatedResearches,
      })
      this.updatePlayerWithSameID(updatedPlayer)
      return updatedPlayer
    })
  }

  private static get saveName(): string {
    return `${SAVE_NAME_PREFIX}_universe`;
  }

  private static playersCodec(playerCodec: Codec<Player> = Player.codec()): Codec<HashMap<number, Player>> {
    class PlayersCodec implements Codec<HashMap<number, Player>> {
      get playerArrayCodec(): Codec<Array<Player>> {
        return new ArrayCodec(playerCodec)
      }

      encode(a: HashMap<number, Player>): Object {
        return this.playerArrayCodec.encode(a.values)
      }

      decode(json: Object): Result<HashMap<number, Player>> {
        return this.playerArrayCodec.decode(json).map(players => {
          const map = ImmutableHashMap.applyWithHashCodeAndEquals<number, Player>(identity, instanceEquals)
          players.forEach(player => map.add(player.id, player))
          return map
        })
      }
    }

    return new PlayersCodec()
  }

  private static planetsCodec(planetsCodec: Codec<Planet> = Planet.codec()): Codec<HashMap<number, Planet>> {
    class PlanetsCodec implements Codec<HashMap<number, Planet>> {
      get planetsArrayCodec(): Codec<Array<Planet>> {
        return new ArrayCodec(planetsCodec)
      }

      encode(a: HashMap<number, Planet>): Object {
        return this.planetsArrayCodec.encode(a.values)
      }

      decode(json: Object): Result<HashMap<number, Planet>> {
        return this.planetsArrayCodec.decode(json).map(planets => {
          const map = ImmutableHashMap.applyWithHashCodeAndEquals<number, Planet>(identity, instanceEquals)
          planets.forEach(planet => map.add(planet.id, planet))
          return map
        })
      }
    }

    return new PlanetsCodec()
  }

  private static moonsCodec(moonsCodec: Codec<Moon> = Moon.codec()): Codec<HashMap<number, Moon>> {
    class MoonsCodec implements Codec<HashMap<number, Moon>> {
      get moonsArrayCodec(): Codec<Array<Moon>> {
        return new ArrayCodec(moonsCodec)
      }

      encode(a: HashMap<number, Moon>): Object {
        return this.moonsArrayCodec.encode(a.values)
      }

      decode(json: Object): Result<HashMap<number, Moon>> {
        return this.moonsArrayCodec.decode(json).map(moons => {
          const map = ImmutableHashMap.applyWithHashCodeAndEquals<number, Moon>(identity, instanceEquals)
          moons.forEach(moon => map.add(moon.id, moon))
          return map
        })
      }
    }

    return new MoonsCodec()
  }

  static codec(
    playerCodec: Codec<HashMap<number, Player>> = Universe.playersCodec(),
    planetsCodec: Codec<HashMap<number, Planet>> = Universe.planetsCodec(),
    moonsCodec: Codec<HashMap<number, Moon>> = Universe.moonsCodec(),
  ): Codec<Universe> {
    const optionalDateCodec = Optional.codec<Date>(Codecs.date)

    class UniverseCodec implements Codec<Universe> {
      encode(a: Universe): Object {
        return Codecs.object.encode({
          playersAPIDate: optionalDateCodec.encode(a.playersAPIDate),
          universeAPIDate: optionalDateCodec.encode(a.universeAPIDate),
          players: playerCodec.encode(a.players),
          planets: planetsCodec.encode(a.planets),
          moons: moonsCodec.encode(a.moons),
        })
      }

      decode(json: Object): Result<Universe> {
        return Codecs.object.decode(json).flatMap(jsonObject => {
          const json = jsonObject as {
            playersAPIDate: string,
            universeAPIDate: string,
            players: string,
            planets: string,
            moons: string,
          }

          return optionalDateCodec.decode(json.playersAPIDate).flatMap(playersAPIDate =>
            optionalDateCodec.decode(json.universeAPIDate).flatMap(universeAPIDate =>
              playerCodec.decode(json.players).flatMap(players =>
                planetsCodec.decode(json.planets).flatMap(planets =>
                  moonsCodec.decode(json.moons).map(moons =>
                    new Universe(playersAPIDate, universeAPIDate, players, planets, moons),
                  ),
                ),
              ),
            ),
          )
        })
      }
    }

    return new UniverseCodec()
  }

  static loadFromLocalStorage(): Universe {
    return this.load(Universe.saveName, Universe.codec()).getOrElse(new Universe())
  }

  saveToLocalStorage(): void {
    this.save(Universe.saveName, Universe.codec())
  }
}

class ParsedReportsRepository extends Storable {
  readonly allReports: HashMap<number, ParsedReport>

  private constructor(allDetails: HashMap<number, ParsedReport> = ImmutableHashMap.applyWithHashCodeAndEquals(identity, instanceEquals)) {
    super();
    this.allReports = allDetails
  }

  add(report: ParsedReport): void {
    this.allReports.add(report.id, report)
    this.saveToLocalStorage()
  }

  async get(message: Message): Promise<ParsedReport> {
    async function getReport(message: Message): Promise<ParsedReport> {
      //console.log(`Getting details for ${message.id}`)

      const detailedReport = await getWithData("index.php?page=messages", {ajax: 1, messageId: message.id})
      const parsedReport = ParsedReport.fromDetailedReport(message, detailedReport, 0.5)
      spyHelper.parsedReportsRepository.add(parsedReport)
      return parsedReport
    }

    return this.allReports.get(message.id).cata<Promise<ParsedReport>>(async () => await getReport(message), Promise.resolve)
  }

  remove(id) {
    this.allReports.delete(id)
    this.saveToLocalStorage()
  }

  static saveName(): string {
    return `${SAVE_NAME_PREFIX}_details`;
  }

  static codec(
    parsedReportCodec: Codec<ParsedReport> = ParsedReport.codec(),
  ): Codec<ParsedReportsRepository> {
    class ParsedReportsRepositoryCodec implements Codec<ParsedReportsRepository> {
      get parsedReportArrayCodec(): Codec<Array<ParsedReport>> {
        return new ArrayCodec(parsedReportCodec)
      }

      encode(a: ParsedReportsRepository): Object {
        return this.parsedReportArrayCodec.encode(a.allReports.values)
      }

      decode(json: Object): Result<ParsedReportsRepository> {
        return this.parsedReportArrayCodec.decode(json).map(reports => {
          const map = ImmutableHashMap.applyWithHashCodeAndEquals<number, ParsedReport>(identity, instanceEquals)
          reports.forEach(report => map.add(report.id, report))
          return map
        }).map(allReports => new ParsedReportsRepository(allReports))
      }
    }

    return new ParsedReportsRepositoryCodec()
  }

  static loadFromLocalStorage(): ParsedReportsRepository {
    return this.load(ParsedReportsRepository.saveName(), ParsedReportsRepository.codec()).getOrElse(new ParsedReportsRepository())
  }

  saveToLocalStorage(): void {
    this.save(ParsedReportsRepository.saveName(), ParsedReportsRepository.codec())
  }
}

class GalaxyParser {
  private readonly universe: Universe

  constructor(universe: Universe) {
    this.universe = universe;
  }

  private static async findPlayerName(id: number): Promise<string> {
    const result = await get(`https://${UNIVERSE}/api/playerData.xml?id=${id}`)
    return Optional.apply(result.find("playerData").attr("name")).toPromise(`Failed to find name of player with ID: ${id}`)
  }

  private async parse(): Promise<void> {
    console.log("Parsing Galaxy")
    await Promise.all($(".row").toArray().map(row => {
      const row$ = $(row);
      return Optional.apply(row$.find(".colonized").get(0))
        .flatMap(colonized => {
          const planetID = Optional.apply($(colonized).attr("data-planet-id")).flatMap(Optional.parseInt)
          const coordinates = Optional.apply(row$.find(".position").attr("data-coords")).flatMap(Coordinates.fromText)
          const moonID = Optional.apply($(row$.find(".moon").get(0)).attr("data-moon-id")).flatMap(Optional.parseInt)
          return planetID.flatMap(planetID =>
            coordinates.flatMap(coordinates => {
              const moon = moonID.map(moonID => this.universe.setNewCoordinatesForMoon(moonID, coordinates))
              const planet = this.universe.updatePlanetWithId(planetID, coordinates, moon)

              return Optional.apply(row$.find(".playername").find("[data-playerid]").attr("data-playerid"))
                .flatMap(Optional.parseInt)
                .map(async playerID => {


                  const playerName = await this.universe.findPlayerByID(playerID).cata(() => GalaxyParser.findPlayerName(playerID), player => Promise.resolve(player.name))
                  this.universe.addPlayerOrUpdateName(playerID, playerName)
                  this.universe.addPlanetToPlayer(playerID, planet)
                })
            })
          )
        })
        .getOrElse(() => Promise.resolve())
    }))
  }

  observe() {
    Optional.apply(document.querySelector("#galaxyContent"))
      .map(target => {
        const mutationObserver = new MutationObserver(() => {
          return this.parse()
        })
        mutationObserver.observe(target, {childList: true})
      })
      .getOrThrow("Failed to find galaxy element to target with mutation observer.")
  }
}

class MessagesParser {
  private readonly universeProperties: UniverseProperties
  private readonly settings: Settings
  private readonly universe: Universe
  private readonly parsedReportsRepository: ParsedReportsRepository

  private readonly config = {childList: true}
  private outerTarget: Optional<Element> = Optional.apply(document.querySelector("#ui-id-2"))

  //private innerTarget: Optional<Element> = this.outerTarget.flatApply(outerTarget => outerTarget.querySelector('.ui-tabs-panel.ui-widget-content.ui-corner-bottom'))
  private get innerTarget(): Optional<Element> {
    return this.outerTarget.flatApply(outerTarget => outerTarget.querySelector(".ui-tabs-panel.ui-widget-content.ui-corner-bottom"))
  }

  innerObserver = new MutationObserver(() => {
    console.log("Inner changed")
    return this.run()
    //SpyHelper.getFirstPage($(innerTarget).find('.tab_inner'));
  })

  outerObserver = new MutationObserver(() => {
    console.log("Outer changed")
    this.innerTarget.map(target => this.innerObserver.observe(target, this.config))
  })

  constructor(universeProperties: UniverseProperties, settings: Settings, universe: Universe, parsedReportsRepository: ParsedReportsRepository) {
    this.universeProperties = universeProperties
    this.settings = settings
    this.universe = universe
    this.parsedReportsRepository = parsedReportsRepository

    this.outerTarget.map(target => this.outerObserver.observe(target, this.config))
  }

  private extractPageNumber(element: JQuery<Element>): Optional<number> {
    return Optional.apply(element.find(".curPage"))
      .map(page => page.get(0).innerHTML)
      .flatApply(text => /\d+\/(\d+)/g.exec(text))
      .flatMap(matches => Optional.parseInt(matches[1]))
  }

  private static getPage(pageNumber: number, callback: (o: Element) => void): Promise<void> {
    const body = {
      messageId: -1,
      tabid: 20, //Espionage
      action: 107,
      pagination: pageNumber,
      ajax: 1,
    }

    return Promise.resolve($.post("?page=messages", body, callback))
  }

  private static getParsedDate(msgID: number, report: JQuery): Optional<Date> {
    const date = report.find(".msg_date");
    date.addClass("sortable");
    const dateElement = date.get(0);
    SpyHelper.addIdAndSortKey(dateElement, msgID, "date");
    // day 1
    // month 2
    // year 3
    // hour 4
    // min 5
    // sec 6
    return Optional.apply(/(\d+)\.(\d+)\.(\d+) (\d+):(\d+):(\d+)/g.exec(dateElement.innerHTML))
      .map(m => {
        report.find(".msg_date").on("click", SpyHelper.sortMessages)
        return new Date(
          Optional.parseInt(m[3]).get,
          Optional.parseInt(m[2]).get - 1,
          Optional.parseInt(m[1]).get,
          Optional.parseInt(m[4]).get,
          Optional.parseInt(m[5]).get,
          Optional.parseInt(m[6]).get,
        )
      })
  }

  private static async handleParsedReport(parsedReport: ParsedReport, report: JQuery): Promise<void> {

  }

  private static async handleMessage(msgID: number, report: JQuery): Promise<void> {
    const coordinates = await CoordinatesWithType.fromReport(report)
      .toPromise(`Failed to get coordinates from report with ID: ${msgID}!`)
    const sender = $(report).find(".msg_sender").get(0).innerHTML

    if (sender !== "Fleet Command" || coordinates.position > 15) return Promise.resolve()

    const reportDate = await MessagesParser.getParsedDate(msgID, report)
      .toPromise(`Failed to get date from report with ID: ${msgID}`)
    const message = new Message(msgID, reportDate)

    const spyIcon = SpyHelper.createSpyIcon(coordinates)
    const iconDiv = $(report).find(".msg_actions").first()
    iconDiv.append(spyIcon);

    spyHelper.messages.push(message)
    const parsedReport = await spyHelper.parsedReportsRepository.get(message)
    console.log(parsedReport)
  }

  private static async handleAllMessages(): Promise<void> {
    const reports = $(".msg:visible").toArray().reduce((acc, report) => {
      const jReport: JQuery = $(report)
      const msgId: number = jReport.data("msg-id");
      //console.log(msgId, report)
      acc.push(MessagesParser.handleMessage(msgId, jReport));
      return acc;
    }, new Array<Promise<void>>())
    await Promise.all(reports)
  }

  async run(): Promise<void> {
    await this.innerTarget.map(target => $(target).find(".tab_inner"))
      .flatMap(innerTab =>
        this.extractPageNumber(innerTab).map(numberOfPages => {
          let requests = new Array<Promise<void>>()
          for (let i = 2; i <= numberOfPages; i++) { //Skip page 1 as we already have it.
            const pageRequest = MessagesParser.getPage(i, element => innerTab.append($(element).find(".msg")))
            requests.push(pageRequest)
          }
          return Promise.all(requests)
        })
      )
      .toPromise("Failed to append messages")
      .then(identity)
    await MessagesParser.handleAllMessages
    $(".pagination").remove() //Remove the page changer as we have all pages loaded already.
    console.log("All done")
  }
}

class SpyHelper {
  universeProperties: UniverseProperties
  settings: Settings
  universe: Universe
  parsedReportsRepository: ParsedReportsRepository
  messages: Array<Message> = new Array<Message>()

  private constructor(universeProperties: UniverseProperties, settings: Settings, universe: Universe, parsedReportsRepository: ParsedReportsRepository) {
    this.universeProperties = universeProperties;
    this.settings = settings;
    this.universe = universe;
    this.parsedReportsRepository = parsedReportsRepository
  }

  static addCSS(): void {
    const link = html`<link rel="stylesheet" type="text/css" href="http://localhost/${SCRIPT_NAME.slice(0, -1)}.css">`
    //const link = html`<link rel="stylesheet" type="text/css" href="https://web.tecnico.ulisboa.pt/samuel.a.martins/${SCRIPT_NAME.slice(0, -1)}.css">`
    document.head.appendChild(link)
  }

  static async load(): Promise<SpyHelper> {

    const universeProperties = await UniverseProperties.get()
    SpyHelper.addCSS()
    const settings = Settings.loadFromLocalStorage()
    const universe = Universe.loadFromLocalStorage()
    const parsedReportsRepository = ParsedReportsRepository.loadFromLocalStorage()
    console.log(`Successfully loaded ${SCRIPT_NAME}`)
    const spyHelper = new SpyHelper(universeProperties, settings, universe, parsedReportsRepository)
    await spyHelper.universe.updateEverything()
    return spyHelper
  }

  run(): Promise<void> {
    if (/research/.test(location.href)) {
      //Currently viewing research page.
      this.settings.updateResearch()
    } else if (/galaxy/.test(location.href)) {
      this.settings.updateDefaultProbes()
      new GalaxyParser(this.universe).observe()
    } else if (/messages/.test(location.href)) {
      //Currently viewing messages page.
      console.log(`startMessagesObservers`)
      new MessagesParser(this.universeProperties, this.settings, this.universe, this.parsedReportsRepository)
      //this.startMessagesObservers()
    }
    return Promise.resolve()
  }

  static addIdAndSortKey(element: Element, msgID: number, sortKey: string): void {
    element.setAttribute("sortKey", sortKey)
    element.id = `${msgID}.${sortKey}`
  }

  static sortMessages(): void {

  }

  static sendProbes(
    mission: Mission,
    coordinates: Coordinates,
    bodyType: CelestialBodyType,
    probesToSend: number,
    target: Element,
  ): Promise<void> {
    const params = {
      mission: mission,
      galaxy: coordinates.galaxy,
      system: coordinates.system,
      position: coordinates.position,
      type: bodyType,
      shipCount: probesToSend,
      // @ts-ignore
      token: miniFleetToken,
    };
    // @ts-ignore
    return Promise.resolve($.ajax(miniFleetLink, {
      data: params,
      dataType: "json",
      type: "POST",
      success: (data) => {
        if (data.newToken !== undefined) {
          // @ts-ignore
          miniFleetToken = data.newToken
        }
        if (data.response.success) {
          target.classList.add("succes") //Not a type success is already in use
        } else {
          target.classList.add("failed")
        }
      },
    }))
  }

  static createElementWithClass(tagName: string, classes: string) {
    const element = document.createElement(tagName)
    element.className = classes
    return element
  }

  static newIcon(classes: string, href: string, onclick: (event) => boolean) {
    const icon = SpyHelper.createElementWithClass("a", "icon_nf_link fleft");
    icon.onclick = onclick;
    // @ts-ignore
    icon.href = href;
    const span = SpyHelper.createElementWithClass("span", "spy_helper default " + classes);
    icon.appendChild(span);
    return icon;
  }

  static createSpyIcon(coordinates: CoordinatesWithType, probesToSend: number = spyHelper.settings.defaultProbes): HTMLElement {
    let probeIcon = ESPIONAGE_PROBE_ICON
    let href
    let onclick
    if (probesToSend === spyHelper.settings.defaultProbes) {
      href = "javascript:void(0)"
      onclick = async (event) => {
        await SpyHelper.sendProbes(Mission.ESPIONAGE, coordinates, coordinates.bodyType, probesToSend, event.target)
        return false;//Returning false cancels the event(that would open the link).
      }
    } else {
      probeIcon += " more"
      /*const targetPartialLink = "ingame&component=fleetdispatch&galaxy=" + coordinates.galaxy +
        "&system=" + coordinates.system + "&position=" + coordinates.position + "&type=" + coordinates.bodyType +
        "&mission=" + Mission.ESPIONAGE + "&am" + ESPIONAGE_PROBE.id + "=" + probesToSend*/
      const targetPartialLink =
        `ingame&component=fleetdispatch&galaxy=${coordinates.galaxy}&system=${coordinates.system}` +
        `&position${coordinates.position}&type=${coordinates.bodyType}&mission=${Mission.ESPIONAGE}` +
        `&am${ESPIONAGE_PROBE.id}=${probesToSend}`
      href = location.href.replace("messages", targetPartialLink);
    }
    return SpyHelper.newIcon(probeIcon, href, onclick);
  }
}

let spyHelper: SpyHelper
$(() => SpyHelper.load().then(s => {
  spyHelper = s
  // @ts-ignore
  window.SpyHelper = s
  return s.run()
}));
