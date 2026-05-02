#!/usr/bin/env tsx
/**
 * Developer-only script: build scripts/global-test-backup.json
 *
 * Combines:
 *   1. Real CSV transactions from ~/Downloads (auto-categorized)
 *   2. A comprehensive synthetic descriptor corpus covering all 6 foundational
 *      categories across US, UK, Canada, Australia, NZ, and Ireland
 *
 * The output uses foundational rule defaultCategoryName values so that
 * analyze-foundational.ts coverage commands work WITHOUT --category= flags.
 *
 * Usage:
 *   npx tsx scripts/build-global-test-backup.ts
 *   => writes scripts/global-test-backup.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Category definitions — names match foundational rule defaultCategoryName
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'cat-food',          name: 'Food & Dining' },
  { id: 'cat-groceries',     name: 'Groceries' },
  { id: 'cat-transport',     name: 'Transportation' },
  { id: 'cat-entertainment', name: 'Entertainment' },
  { id: 'cat-shopping',      name: 'Shopping' },
  { id: 'cat-health',        name: 'Health' },
  { id: 'cat-other',         name: 'Other' },
];

const CAT_ID: Record<string, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.name, c.id])
);

// ---------------------------------------------------------------------------
// Synthetic corpus — one entry per realistic real-world descriptor variant
// Organized by category, annotated by region where non-obvious.
// ---------------------------------------------------------------------------

type SyntheticEntry = { description: string; category: string };

const FOOD: SyntheticEntry[] = [
  // ── US Fast Food ──────────────────────────────────────────────────────────
  { description: "MCDONALD'S #8356 DALLAS TX",           category: 'Food & Dining' },
  { description: "MC DONALD S F18050",                   category: 'Food & Dining' },
  { description: "MCDONALDS 123 CHICAGO IL",             category: 'Food & Dining' },
  { description: "BURGER KING #17335",                   category: 'Food & Dining' },
  { description: "BK 5125 1V9SX4",                      category: 'Food & Dining' },
  { description: "WENDY'S # 8713",                       category: 'Food & Dining' },
  { description: "WENDYS 11772 COLUMBUS OH",             category: 'Food & Dining' },
  { description: "TACO BELL #036335",                    category: 'Food & Dining' },
  { description: "DD *DOORDASH TACOBELL",                category: 'Food & Dining' },
  { description: "CHICK FIL A 3400212",                  category: 'Food & Dining' },
  { description: "CHIK FIL A NASHVILLE TN",              category: 'Food & Dining' },
  { description: "POPEYES #10934 HOUSTON TX",            category: 'Food & Dining' },
  { description: "POPEYE'S CHICKEN 8823",                category: 'Food & Dining' },
  { description: "KFC #Y123456",                         category: 'Food & Dining' },
  { description: "KFC 000442 MEMPHIS TN",                category: 'Food & Dining' },
  { description: "SONIC DRIVE IN #2341",                 category: 'Food & Dining' },
  { description: "SONIC 4521 OKLAHOMA CITY",             category: 'Food & Dining' },
  { description: "JACK IN THE BOX 0159",                 category: 'Food & Dining' },
  { description: "JACK IN BOX #4412",                    category: 'Food & Dining' },
  { description: "HARDEE'S 1508",                        category: 'Food & Dining' },
  { description: "CARL'S JR. #1207",                     category: 'Food & Dining' },
  { description: "CARLS JR 9023 LOS ANGELES CA",         category: 'Food & Dining' },
  { description: "DEL TACO #0884",                       category: 'Food & Dining' },
  { description: "WHATABURGER 1016",                     category: 'Food & Dining' },
  { description: "WHATABURGER 567 SAN ANTONIO TX",       category: 'Food & Dining' },
  { description: "IN N OUT BURGER 152 MOUNTAIN VIEW CA", category: 'Food & Dining' },
  { description: "IN-N-OUT BURGER #320",                 category: 'Food & Dining' },
  { description: "FIVE GUYS 0014 ECOMM",                 category: 'Food & Dining' },
  { description: "5GUYS 0059 QSR ARLINGTON VA",          category: 'Food & Dining' },
  { description: "SHAKE SHACK 4032",                     category: 'Food & Dining' },
  { description: "JFK SHAKESHACK B236352",               category: 'Food & Dining' },
  { description: "RAISING CANE'S #34009",                category: 'Food & Dining' },
  { description: "RAISING CANES 0724 BATON ROUGE LA",    category: 'Food & Dining' },
  { description: "WINGSTOP 1230 COACHELLA CA",           category: 'Food & Dining' },
  { description: "WINGSTOP 724 0001 LOS ANGELES",        category: 'Food & Dining' },
  { description: "CULVERS 0082 MADISON WI",              category: 'Food & Dining' },
  { description: "CULVER'S #0133",                       category: 'Food & Dining' },
  { description: "WHITE CASTLE #0038",                   category: 'Food & Dining' },
  { description: "COOK OUT 0214 RALEIGH NC",             category: 'Food & Dining' },
  { description: "ZAXBY'S #0429",                        category: 'Food & Dining' },
  { description: "BOJANGLES 0512 CHARLOTTE NC",          category: 'Food & Dining' },
  { description: "CHURCH'S CHICKEN #1293",               category: 'Food & Dining' },
  { description: "EL POLLO LOCO #6823",                  category: 'Food & Dining' },
  { description: "CHECKERS #3401",                       category: 'Food & Dining' },
  { description: "RALLY'S 0721",                         category: 'Food & Dining' },
  { description: "STEAK N SHAKE #0312",                  category: 'Food & Dining' },
  { description: "WIENERSCHNITZEL 0054",                 category: 'Food & Dining' },
  { description: "KRYSTAL 0182 BIRMINGHAM AL",           category: 'Food & Dining' },
  { description: "FREDDY'S #0293",                       category: 'Food & Dining' },
  { description: "SMASHBURGER 0184",                     category: 'Food & Dining' },
  { description: "SHAKE SHACK 9811 BOSTON MA",           category: 'Food & Dining' },

  // ── US Fast Casual ────────────────────────────────────────────────────────
  { description: "CHIPOTLE 2456",                        category: 'Food & Dining' },
  { description: "CHIPOTLE #2899 AUSTIN TX",             category: 'Food & Dining' },
  { description: "CHIPOTLE ONLINE",                      category: 'Food & Dining' },
  { description: "PANERA BREAD #202104",                 category: 'Food & Dining' },
  { description: "PANERA BREAD #202118 K",               category: 'Food & Dining' },
  { description: "SWEETGREEN 16TH + MA",                 category: 'Food & Dining' },
  { description: "DD *SWEETGREEN",                       category: 'Food & Dining' },
  { description: "CAVA 10012 WESTWOOD",                  category: 'Food & Dining' },
  { description: "10057D CAVA DTWN AUSTI",               category: 'Food & Dining' },
  { description: "MOD PIZZA 0394",                       category: 'Food & Dining' },
  { description: "MOD PIZZA SEATTLE WA",                 category: 'Food & Dining' },
  { description: "NOODLES & COMPANY 0211",               category: 'Food & Dining' },
  { description: "NOODLES CO 0814",                      category: 'Food & Dining' },
  { description: "QDOBA MEXICAN GRILL 0192",             category: 'Food & Dining' },
  { description: "MOES SOUTHWEST GRILL 0394",            category: 'Food & Dining' },
  { description: "PANDA EXPRESS #3214",                  category: 'Food & Dining' },
  { description: "PANDA EXPRESS 1293 IRVINE CA",         category: 'Food & Dining' },
  { description: "WABA GRILL #0212",                     category: 'Food & Dining' },
  { description: "FLAME BROILER 0193",                   category: 'Food & Dining' },
  { description: "FRESHII 0293",                         category: 'Food & Dining' },
  { description: "POTBELLY SANDWICH 0382",               category: 'Food & Dining' },
  { description: "WHICH WICH 0192",                      category: 'Food & Dining' },
  { description: "FIREHOUSE SUBS 0312",                  category: 'Food & Dining' },
  { description: "JERSEY MIKES SUBS 0829",               category: 'Food & Dining' },
  { description: "JERSEY MIKE'S #1234",                  category: 'Food & Dining' },
  { description: "JASON'S DELI 0293",                    category: 'Food & Dining' },
  { description: "MCALISTER'S DELI 0392",                category: 'Food & Dining' },
  { description: "EINSTEIN BROS BAGELS",                 category: 'Food & Dining' },
  { description: "MANHATTAN BAGEL 0193",                 category: 'Food & Dining' },
  { description: "BOSTON MARKET 0192",                   category: 'Food & Dining' },
  { description: "COSI 0293",                            category: 'Food & Dining' },
  { description: "TORCHYS TACOS 0492",                   category: 'Food & Dining' },
  { description: "FREEBIRDS WORLD BURRITO",              category: 'Food & Dining' },

  // ── US Pizza ──────────────────────────────────────────────────────────────
  { description: "DOMINO'S 8033",                        category: 'Food & Dining' },
  { description: "DOMINO S 7011",                        category: 'Food & Dining' },
  { description: "DOMINOS #10459",                       category: 'Food & Dining' },
  { description: "PIZZA HUT 042394",                     category: 'Food & Dining' },
  { description: "PIZZA HUT # 034007",                   category: 'Food & Dining' },
  { description: "PAPA JOHN'S #2027",                    category: 'Food & Dining' },
  { description: "PAPA JOHNS 380",                       category: 'Food & Dining' },
  { description: "PAPA JOHN'S #04300 843-774-0444 SC",   category: 'Food & Dining' },
  { description: "LITTLE CAESARS 0392",                  category: 'Food & Dining' },
  { description: "LITTLE CAESARS PIZZA 1492",            category: 'Food & Dining' },
  { description: "CICIS PIZZA 0192",                     category: 'Food & Dining' },
  { description: "MARCOS PIZZA 0392",                    category: 'Food & Dining' },
  { description: "ROUND TABLE PIZZA 0193",               category: 'Food & Dining' },
  { description: "HUNGRY HOWIE'S 0293",                  category: 'Food & Dining' },
  { description: "GODFATHER'S PIZZA",                    category: 'Food & Dining' },
  { description: "SBARRO 0194",                          category: 'Food & Dining' },

  // ── US Coffee / Donuts ────────────────────────────────────────────────────
  { description: "STARBUCKS 513108",                     category: 'Food & Dining' },
  { description: "3286 IAD STARBUCKS 844",               category: 'Food & Dining' },
  { description: "STARBUCKS CARD RELOAD",                category: 'Food & Dining' },
  { description: "STARBUCKS.COM",                        category: 'Food & Dining' },
  { description: "DUNKIN #356199",                       category: 'Food & Dining' },
  { description: "DD BR #301635 Q35",                    category: 'Food & Dining' },
  { description: "DUNKIN DONUTS DULLESCO",               category: 'Food & Dining' },
  { description: "DUTCH BROS COFFEE 0293",               category: 'Food & Dining' },
  { description: "DUTCH BROS #0529",                     category: 'Food & Dining' },
  { description: "PEETS COFFEE 0392",                    category: 'Food & Dining' },
  { description: "PEET'S COFFEE #1293",                  category: 'Food & Dining' },
  { description: "CARIBOU COFFEE 0293",                  category: 'Food & Dining' },
  { description: "THE COFFEE BEAN 0392",                 category: 'Food & Dining' },
  { description: "COFFEE BEAN & TEA LEAF",               category: 'Food & Dining' },
  { description: "DONUT KING 0192",                      category: 'Food & Dining' },
  { description: "SHIPLEY DO-NUT 0293",                  category: 'Food & Dining' },
  { description: "KRISPY KREME 0392",                    category: 'Food & Dining' },
  { description: "CINNABON 0293 MALL",                   category: 'Food & Dining' },
  { description: "AUNTIE ANNE'S 0394",                   category: 'Food & Dining' },
  { description: "WETZEL'S PRETZELS 0192",               category: 'Food & Dining' },
  { description: "TST* BLUE BOTTLE COFFEE",              category: 'Food & Dining' },
  { description: "TST* INTELLIGENTSIA COFFEE",           category: 'Food & Dining' },

  // ── US Casual / Full-Service Dining ───────────────────────────────────────
  { description: "APPLEBEE'S GRILL + BAR 0392",          category: 'Food & Dining' },
  { description: "APPLEBEES 0293 ORLANDO FL",            category: 'Food & Dining' },
  { description: "CHILI'S #0394",                        category: 'Food & Dining' },
  { description: "CHILIS GRILL BAR 1092",                category: 'Food & Dining' },
  { description: "OLIVE GARDEN 0392",                    category: 'Food & Dining' },
  { description: "OLIVE GARDEN ITALIAN 1293",            category: 'Food & Dining' },
  { description: "RED LOBSTER 0293",                     category: 'Food & Dining' },
  { description: "OUTBACK STEAKHOUSE 0392",              category: 'Food & Dining' },
  { description: "OUTBACK 0293 TAMPA FL",                category: 'Food & Dining' },
  { description: "TEXAS ROADHOUSE 0293",                 category: 'Food & Dining' },
  { description: "LONGHORN STEAKHOUSE 0293",             category: 'Food & Dining' },
  { description: "TGI FRIDAY'S 0293",                    category: 'Food & Dining' },
  { description: "TGI FRIDAYS #0392",                    category: 'Food & Dining' },
  { description: "RUBY TUESDAY 0293",                    category: 'Food & Dining' },
  { description: "DENNY'S #0392",                        category: 'Food & Dining' },
  { description: "IHOP 0293",                            category: 'Food & Dining' },
  { description: "IHOP #392 PHOENIX AZ",                 category: 'Food & Dining' },
  { description: "WAFFLE HOUSE #0912",                   category: 'Food & Dining' },
  { description: "CRACKER BARREL 0293",                  category: 'Food & Dining' },
  { description: "BOB EVANS 0293",                       category: 'Food & Dining' },
  { description: "PERKINS RESTAURANT 0192",              category: 'Food & Dining' },
  { description: "SIZZLER 0192",                         category: 'Food & Dining' },
  { description: "GOLDEN CORRAL 0293",                   category: 'Food & Dining' },
  { description: "BUFFET KING 0192",                     category: 'Food & Dining' },
  { description: "P.F. CHANG'S 0293",                    category: 'Food & Dining' },
  { description: "PF CHANGS 0192",                       category: 'Food & Dining' },
  { description: "CHEESECAKE FACTORY 0392",              category: 'Food & Dining' },
  { description: "BJ'S RESTAURANT 0293",                 category: 'Food & Dining' },
  { description: "RED ROBIN 0293",                       category: 'Food & Dining' },
  { description: "BAHAMA BREEZE 0192",                   category: 'Food & Dining' },
  { description: "CARRABBA'S ITALIAN 0192",              category: 'Food & Dining' },
  { description: "BONEFISH GRILL 0192",                  category: 'Food & Dining' },
  { description: "BUFFALO WILD WINGS 0293",              category: 'Food & Dining' },
  { description: "BWW #0392",                            category: 'Food & Dining' },
  { description: "HOOTERS 0293",                         category: 'Food & Dining' },
  { description: "YARD HOUSE 0293",                      category: 'Food & Dining' },
  { description: "SEASONS 52 0192",                      category: 'Food & Dining' },
  { description: "EDDIE V'S 0192",                       category: 'Food & Dining' },

  // ── US Ice Cream / Dessert ────────────────────────────────────────────────
  { description: "DAIRY QUEEN #0392",                    category: 'Food & Dining' },
  { description: "DAIRY QUEEN 1293 HOUSTON TX",          category: 'Food & Dining' },
  { description: "COLD STONE CREAMERY 0293",             category: 'Food & Dining' },
  { description: "BASKIN-ROBBINS #0293",                 category: 'Food & Dining' },
  { description: "BASKIN ROBBINS 1293",                  category: 'Food & Dining' },
  { description: "PINKBERRY 0192",                       category: 'Food & Dining' },
  { description: "MENCHIES FROZEN YOGURT",               category: 'Food & Dining' },
  { description: "YOGURTLAND 0192",                      category: 'Food & Dining' },
  { description: "JAMBA JUICE 0293",                     category: 'Food & Dining' },
  { description: "SMOOTHIE KING #0392",                  category: 'Food & Dining' },
  { description: "TROPICAL SMOOTHIE CAFE 0192",          category: 'Food & Dining' },
  { description: "CRUMBL COOKIES 0192",                  category: 'Food & Dining' },
  { description: "INSOMNIA COOKIES 0192",                category: 'Food & Dining' },
  { description: "NOTHING BUNDT CAKES",                  category: 'Food & Dining' },

  // ── US Delivery & Meal Kit ────────────────────────────────────────────────
  { description: "DD *DOORDASH",                         category: 'Food & Dining' },
  { description: "DOORDASH*CHIPOTLE",                    category: 'Food & Dining' },
  { description: "DD *CAVIAR SWEETGREEN",                category: 'Food & Dining' },
  { description: "DOORDASH DASHPASS",                    category: 'Food & Dining' },
  { description: "DLO*UBER EATS",                        category: 'Food & Dining' },
  { description: "DLC*UBER EATS",                        category: 'Food & Dining' },
  { description: "UBER * EATS",                          category: 'Food & Dining' },
  { description: "GRUBHUB",                              category: 'Food & Dining' },
  { description: "GRUBHUB CAMPUS DINING",                category: 'Food & Dining' },
  { description: "GRUBHUB*SWEETGREEN",                   category: 'Food & Dining' },
  { description: "SEAMLESS 0192",                        category: 'Food & Dining' },
  { description: "SEAMLSS*SWEETGREEN",                   category: 'Food & Dining' },
  { description: "POSTMATES SAN FRANCISCO CA",           category: 'Food & Dining' },
  { description: "DELIVEROO *ORDER",                     category: 'Food & Dining' },    // UK
  { description: "DELIVEROO PLUS",                       category: 'Food & Dining' },    // UK
  { description: "JUST EAT *ORDER",                      category: 'Food & Dining' },    // UK/IE/CA
  { description: "JUST EAT LTD",                         category: 'Food & Dining' },    // UK
  { description: "SKIP*SKIP THE DISHES",                 category: 'Food & Dining' },    // CA
  { description: "SKIPTHEDISHES.COM",                    category: 'Food & Dining' },    // CA
  { description: "GOPUFF",                               category: 'Food & Dining' },
  { description: "EZCATER*CATERING ORDER",               category: 'Food & Dining' },
  { description: "HELLOFRESH",                           category: 'Food & Dining' },
  { description: "HELLO FRESH MEALS",                    category: 'Food & Dining' },
  { description: "BLUE APRON",                           category: 'Food & Dining' },
  { description: "HOME CHEF",                            category: 'Food & Dining' },
  { description: "EVERYPLATE",                           category: 'Food & Dining' },
  { description: "GREEN CHEF",                           category: 'Food & Dining' },
  { description: "SUNBASKET",                            category: 'Food & Dining' },
  { description: "FACTOR 75",                            category: 'Food & Dining' },
  { description: "DINNERLY",                             category: 'Food & Dining' },
  { description: "MARLEY SPOON",                         category: 'Food & Dining' },

  // ── US Toast POS (restaurant-only) ───────────────────────────────────────
  { description: "TST* MORNING GLORY CAFE",              category: 'Food & Dining' },
  { description: "TST* RIVER CITY GRILLE",               category: 'Food & Dining' },
  { description: "TST* HARBOR LIGHTS BISTRO",            category: 'Food & Dining' },
  { description: "TST* MAIN STREET DINER",               category: 'Food & Dining' },
  { description: "TST* BLUE SKY BAKERY",                 category: 'Food & Dining' },
  { description: "TST* CORNER TAQUERIA",                 category: 'Food & Dining' },
  { description: "TST* SUNSET SUSHI",                    category: 'Food & Dining' },
  { description: "TST* UPTOWN RAMEN",                    category: 'Food & Dining' },
  { description: "TST* PACIFIC POKE",                    category: 'Food & Dining' },
  { description: "TST* HILLSIDE KITCHEN",                category: 'Food & Dining' },

  // ── Lexicon — generic food nouns that catch independents ──────────────────
  { description: "DOWNTOWN CAFE 192",                    category: 'Food & Dining' },
  { description: "HARBOR VIEW CAFE",                     category: 'Food & Dining' },
  { description: "BLUE DOOR CAFE PORTLAND OR",           category: 'Food & Dining' },
  { description: "CAFE GRATITUDE LOS ANGELES CA",        category: 'Food & Dining' },
  { description: "CAFE INTERMEZZO",                      category: 'Food & Dining' },
  { description: "CAFFE VITA SEATTLE WA",                category: 'Food & Dining' },
  { description: "CAFFE NERO UK",                        category: 'Food & Dining' },    // UK
  { description: "OAT BAKERY SANTA BARBARA CA",          category: 'Food & Dining' },
  { description: "SUNRISE BAKERY 0192",                  category: 'Food & Dining' },
  { description: "VILLAGE BAKERY",                       category: 'Food & Dining' },
  { description: "GREGGS 00123",                         category: 'Food & Dining' },    // UK
  { description: "GREGGS BAKERY LONDON",                 category: 'Food & Dining' },    // UK
  { description: "WELSH BAKER GOLETA CA",                category: 'Food & Dining' },
  { description: "BROOKLYN BAGEL CO",                    category: 'Food & Dining' },
  { description: "NOHO BAGEL",                           category: 'Food & Dining' },
  { description: "WESTSIDE DELI & CAFE",                 category: 'Food & Dining' },
  { description: "MAIN STREET DELI 0192",                category: 'Food & Dining' },
  { description: "OCEAN VIEW BISTRO",                    category: 'Food & Dining' },
  { description: "LA PETITE BRASSERIE PARIS",            category: 'Food & Dining' },
  { description: "THE RUSTIC TAVERN",                    category: 'Food & Dining' },
  { description: "RED STAG TAVERN PORTLAND OR",          category: 'Food & Dining' },
  { description: "MOUNTAIN GRILL 0293",                  category: 'Food & Dining' },
  { description: "OCEAN GRILL SEAFOOD SANTA BARBARA",    category: 'Food & Dining' },
  { description: "TEXAN BBQ 0192",                       category: 'Food & Dining' },
  { description: "MAPLEWOOD BBQ & SMOKEHOUSE",           category: 'Food & Dining' },
  { description: "CENTRAL BBQ MEMPHIS TN",               category: 'Food & Dining' },
  { description: "GARCIA'S TAQUERIA AUSTIN TX",          category: 'Food & Dining' },
  { description: "TAQUERIA LILLYS GOLETA CA",            category: 'Food & Dining' },
  { description: "EL RANCHO TAQUERIA 0192",              category: 'Food & Dining' },
  { description: "ROSA'S PIZZA & PASTA",                 category: 'Food & Dining' },
  { description: "FRANK'S PIZZERIA 0192",                category: 'Food & Dining' },
  { description: "BROADWAY PIZZA RESTAURANT",            category: 'Food & Dining' },
  { description: "SAKURA SUSHI RESTAURANT",              category: 'Food & Dining' },
  { description: "BLUE SUSHI SAKE GRILL",                category: 'Food & Dining' },
  { description: "GOLDEN DRAGON CHINESE RESTAURANT",     category: 'Food & Dining' },
  { description: "PHO SAIGON RESTAURANT",                category: 'Food & Dining' },
  { description: "PHO 999 WESTMINSTER CA",               category: 'Food & Dining' },
  { description: "RAMEN NOODLE BAR 0192",                category: 'Food & Dining' },
  { description: "SAKURA RAMEN HOUSE",                   category: 'Food & Dining' },
  { description: "DIM SUM GARDEN 0192",                  category: 'Food & Dining' },
  { description: "JADE WONTON HOUSE",                    category: 'Food & Dining' },
  { description: "DUMPLING KINGDOM",                     category: 'Food & Dining' },
  { description: "GYRO KING 0192",                       category: 'Food & Dining' },
  { description: "MEDITERRANEAN GRILLE",                 category: 'Food & Dining' },
  { description: "OLD SOUTH RESTAURANT GOLETA CA",       category: 'Food & Dining' },
  { description: "MISSION CITY SANDWICH",                category: 'Food & Dining' },
  { description: "JAVA STATION GOLETA CA",               category: 'Food & Dining' },
  { description: "POKE BOWL COMPANY 0192",               category: 'Food & Dining' },
  { description: "ISLAND POKE 0192",                     category: 'Food & Dining' },
  { description: "BOBA HOUSE 0192",                      category: 'Food & Dining' },
  { description: "TIGER SUGAR BOBA",                     category: 'Food & Dining' },
  { description: "VEGAN BOWL KITCHEN",                   category: 'Food & Dining' },
  { description: "ESPRESSO ROYALE",                      category: 'Food & Dining' },
  { description: "KEBAB HOUSE 0192",                     category: 'Food & Dining' },
  { description: "BERLIN DONER KEBAB",                   category: 'Food & Dining' },
  { description: "STEAKHOUSE 55 DISNEYLAND",             category: 'Food & Dining' },
  { description: "RUBY'S SMOKEHOUSE 0192",               category: 'Food & Dining' },
  { description: "CATERING BY JAMES 0192",               category: 'Food & Dining' },
  { description: "CORPORATE CATERING CO",                category: 'Food & Dining' },
  { description: "TERIYAKI MADNESS 0192",                category: 'Food & Dining' },
  { description: "TOKYO JOE'S TERIYAKI",                 category: 'Food & Dining' },
  { description: "WOK EXPRESS 0192",                     category: 'Food & Dining' },
  { description: "TAKEAWAY.COM ORDER",                   category: 'Food & Dining' },    // EU
  { description: "CHIPPY FISH AND CHIPS",                category: 'Food & Dining' },    // UK

  // ── UK Chains ─────────────────────────────────────────────────────────────
  { description: "NANDOS 0392",                          category: 'Food & Dining' },
  { description: "NANDO'S STRATFORD",                    category: 'Food & Dining' },
  { description: "PRET A MANGER 0293",                   category: 'Food & Dining' },
  { description: "PRET A MANGER LONDON",                 category: 'Food & Dining' },
  { description: "WAGAMAMA 0293",                        category: 'Food & Dining' },
  { description: "WAGAMAMA MANCHESTER",                  category: 'Food & Dining' },
  { description: "ITSU 0293",                            category: 'Food & Dining' },
  { description: "WASABI SUSHI LONDON",                  category: 'Food & Dining' },
  { description: "TORTILLA MEXICAN GRILL",               category: 'Food & Dining' },
  { description: "LEON RESTAURANTS 0192",                category: 'Food & Dining' },
  { description: "HONEST BURGERS 0192",                  category: 'Food & Dining' },
  { description: "BYRON HAMBURGERS 0192",                category: 'Food & Dining' },
  { description: "GBK GOURMET BURGER",                   category: 'Food & Dining' },
  { description: "FIVE GUYS BURGERS UK",                 category: 'Food & Dining' },
  { description: "PIZZA EXPRESS 0293",                   category: 'Food & Dining' },
  { description: "PIZZA EXPRESS OXFORD",                 category: 'Food & Dining' },
  { description: "ASK ITALIAN 0192",                     category: 'Food & Dining' },
  { description: "ZIZZI RESTAURANTS 0192",               category: 'Food & Dining' },
  { description: "PREZZO ITALIAN 0192",                  category: 'Food & Dining' },
  { description: "BELLA ITALIA 0192",                    category: 'Food & Dining' },
  { description: "CARLUCCIO'S 0192",                     category: 'Food & Dining' },
  { description: "YO SUSHI 0192",                        category: 'Food & Dining' },
  { description: "ITSU SUSHI & NOODLES 0192",            category: 'Food & Dining' },
  { description: "COSTA COFFEE 0293",                    category: 'Food & Dining' },
  { description: "COSTA COFFEE LONDON",                  category: 'Food & Dining' },
  { description: "CAFFE NERO 0293",                      category: 'Food & Dining' },
  { description: "NERO COFFEE",                          category: 'Food & Dining' },
  { description: "MCDONALD'S BIRMINGHAM UK",             category: 'Food & Dining' },
  { description: "KFC LONDON 0192",                      category: 'Food & Dining' },
  { description: "SUBWAY 05268 UK",                      category: 'Food & Dining' },

  // ── Canadian Chains ───────────────────────────────────────────────────────
  { description: "TIM HORTONS #0293",                    category: 'Food & Dining' },
  { description: "TIM HORTONS 1293 TORONTO",             category: 'Food & Dining' },
  { description: "HARVEY'S BURGERS 0192",                category: 'Food & Dining' },
  { description: "SWISS CHALET 0192",                    category: 'Food & Dining' },
  { description: "THE KEG STEAKHOUSE 0192",              category: 'Food & Dining' },
  { description: "EAST SIDE MARIO'S 0192",               category: 'Food & Dining' },
  { description: "MARY BROWN'S CHICKEN",                 category: 'Food & Dining' },
  { description: "NEW YORK FRIES 0192",                  category: 'Food & Dining' },
  { description: "MUCHO BURRITO 0192",                   category: 'Food & Dining' },
  { description: "MCDONALD'S TORONTO",                   category: 'Food & Dining' },

  // ── Australian / NZ Chains ────────────────────────────────────────────────
  { description: "HUNGRY JACKS 0192",                    category: 'Food & Dining' },    // AU Burger King brand
  { description: "HUNGRY JACK'S SYDNEY",                 category: 'Food & Dining' },
  { description: "RED ROOSTER 0192",                     category: 'Food & Dining' },
  { description: "GUZMAN Y GOMEZ 0192",                  category: 'Food & Dining' },
  { description: "GUZMAN GOMEZ SYDNEY",                  category: 'Food & Dining' },
  { description: "OPORTO CHICKEN 0192",                  category: 'Food & Dining' },
  { description: "NANDOS MELBOURNE",                     category: 'Food & Dining' },
  { description: "DOMINO'S PIZZA AU 0192",               category: 'Food & Dining' },
  { description: "PIZZA HUT AUSTRALIA 0192",             category: 'Food & Dining' },
  { description: "MCDONALD'S AUSTRALIA",                 category: 'Food & Dining' },
  { description: "KFC AUSTRALIA 0192",                   category: 'Food & Dining' },
  { description: "SUBWAY AUSTRALIA 0192",                category: 'Food & Dining' },
  { description: "BURGER FUEL 0192",                     category: 'Food & Dining' },    // NZ
  { description: "HELL PIZZA 0192",                      category: 'Food & Dining' },    // NZ
  { description: "GEORGIE PIE 0192",                     category: 'Food & Dining' },    // NZ
  { description: "UBEREatsPAYMENT AU",                   category: 'Food & Dining' },
  { description: "MENULOG ORDER",                        category: 'Food & Dining' },    // AU/NZ

  // ── Irish Chains ──────────────────────────────────────────────────────────
  { description: "SUPERMAC'S 0192",                      category: 'Food & Dining' },
  { description: "SUPERMACS GALWAY",                     category: 'Food & Dining' },
  { description: "EDDIE ROCKET'S 0192",                  category: 'Food & Dining' },
  { description: "MCDONALD'S DUBLIN",                    category: 'Food & Dining' },
  { description: "KFC IRELAND 0192",                     category: 'Food & Dining' },
];

const GROCERIES: SyntheticEntry[] = [
  // ── US Premium / Specialty ────────────────────────────────────────────────
  { description: "WHOLE FOODS #10192",                   category: 'Groceries' },
  { description: "WHOLE FOODS MARKET 0293",              category: 'Groceries' },
  { description: "TRADER JOE'S #0293",                   category: 'Groceries' },
  { description: "TRADER JOES 1293 SANTA BARBARA CA",    category: 'Groceries' },
  { description: "SPROUTS FARMERS MARKET 0293",          category: 'Groceries' },
  { description: "THE FRESH MARKET 0192",                category: 'Groceries' },
  { description: "EARTH FARE 0192",                      category: 'Groceries' },
  { description: "NATURAL GROCERS 0192",                 category: 'Groceries' },

  // ── US National Chains ────────────────────────────────────────────────────
  { description: "KROGER #0392",                         category: 'Groceries' },
  { description: "KROGER FUEL 0293 DALLAS TX",           category: 'Groceries' },
  { description: "SAFEWAY #2293",                        category: 'Groceries' },
  { description: "SAFEWAY 0293 GOLETA CA",               category: 'Groceries' },
  { description: "ALBERTSONS #0354 GOLETA CA",           category: 'Groceries' },
  { description: "ALBERTSONS 0293",                      category: 'Groceries' },
  { description: "PUBLIX #0293",                         category: 'Groceries' },
  { description: "PUBLIX SUPER MARKET 1293",             category: 'Groceries' },
  { description: "HEB PLUS #0293",                       category: 'Groceries' },
  { description: "HEB 0293 AUSTIN TX",                   category: 'Groceries' },
  { description: "MEIJER #0293",                         category: 'Groceries' },
  { description: "MEIJER SUPERSTORE 1293",               category: 'Groceries' },
  { description: "GIANT FOOD #0293",                     category: 'Groceries' },
  { description: "GIANT EAGLE #0293",                    category: 'Groceries' },
  { description: "STOP & SHOP 0293",                     category: 'Groceries' },
  { description: "STOP AND SHOP 1293",                   category: 'Groceries' },
  { description: "WEGMANS #0293",                        category: 'Groceries' },
  { description: "WEGMANS FOOD MARKETS",                 category: 'Groceries' },
  { description: "HARRIS TEETER 0293",                   category: 'Groceries' },
  { description: "HARRIS TEETER #1293",                  category: 'Groceries' },
  { description: "FOOD LION #0293",                      category: 'Groceries' },
  { description: "FOOD LION 1293 DURHAM NC",             category: 'Groceries' },
  { description: "WINN-DIXIE #0293",                     category: 'Groceries' },
  { description: "WINN DIXIE 1293",                      category: 'Groceries' },
  { description: "PIGGLY WIGGLY 0192",                   category: 'Groceries' },
  { description: "BI-LO #0293",                          category: 'Groceries' },
  { description: "VONS #0293 GOLETA CA",                 category: 'Groceries' },
  { description: "VONS PAVILIONS 1293",                  category: 'Groceries' },
  { description: "RALPHS #0293",                         category: 'Groceries' },
  { description: "RALPHS GROCERY 1293 LA CA",            category: 'Groceries' },
  { description: "FRED MEYER #0293",                     category: 'Groceries' },
  { description: "FRED MEYER STORES 1293",               category: 'Groceries' },
  { description: "KING SOOPERS #0293",                   category: 'Groceries' },
  { description: "FRIES MARKET #0293",                   category: 'Groceries' },
  { description: "FRYS FOOD #0293",                      category: 'Groceries' },
  { description: "SMITH'S FOOD AND DRUG 0293",           category: 'Groceries' },
  { description: "SMITHS FOOD 1293 SALT LAKE CITY UT",   category: 'Groceries' },
  { description: "DILLONS #0293",                        category: 'Groceries' },
  { description: "BAKER'S 0192",                         category: 'Groceries' },
  { description: "QFC QUALITY FOOD 0293",                category: 'Groceries' },
  { description: "CITY MARKET 0293",                     category: 'Groceries' },
  { description: "PICK N SAVE 0293",                     category: 'Groceries' },
  { description: "MARIANO'S 0293",                       category: 'Groceries' },
  { description: "JEWEL-OSCO #0293",                     category: 'Groceries' },
  { description: "JEWEL OSCO 1293 CHICAGO IL",           category: 'Groceries' },
  { description: "RANDALLS #0293",                       category: 'Groceries' },
  { description: "TOM THUMB 0293",                       category: 'Groceries' },
  { description: "ACME MARKETS 0293",                    category: 'Groceries' },
  { description: "SHAW'S 0293",                          category: 'Groceries' },
  { description: "HANNAFORD #0293",                      category: 'Groceries' },
  { description: "PRICE CHOPPER 0293",                   category: 'Groceries' },
  { description: "MARKET BASKET 0293",                   category: 'Groceries' },
  { description: "INGLES MARKETS 0293",                  category: 'Groceries' },
  { description: "SHOPRITE #0293",                       category: 'Groceries' },
  { description: "FOOD4LESS #0293",                      category: 'Groceries' },
  { description: "FOOD 4 LESS 1293 LOS ANGELES CA",      category: 'Groceries' },
  { description: "SMART & FINAL #0293",                  category: 'Groceries' },
  { description: "SMART AND FINAL 1293",                 category: 'Groceries' },
  { description: "GROCERY OUTLET #0293",                 category: 'Groceries' },
  { description: "GROCERY OUTLET BARGAIN 1293",          category: 'Groceries' },
  { description: "WINCO FOODS #0293",                    category: 'Groceries' },
  { description: "WINCO 1293 BOISE ID",                  category: 'Groceries' },
  { description: "RALEY'S #0293",                        category: 'Groceries' },
  { description: "HY-VEE #0293",                         category: 'Groceries' },
  { description: "HY VEE 1293 DES MOINES IA",            category: 'Groceries' },
  { description: "FAREWAY STORES 0293",                  category: 'Groceries' },
  { description: "STATER BROS MARKETS 0293",             category: 'Groceries' },
  { description: "STATER BROS #0192",                    category: 'Groceries' },
  { description: "BASHAS #0293",                         category: 'Groceries' },
  { description: "FOOD CITY 0293",                       category: 'Groceries' },
  { description: "WEI'S MARKET 0192",                    category: 'Groceries' },
  { description: "WEEE GROCERY 0192",                    category: 'Groceries' },

  // ── US Warehouse Clubs ────────────────────────────────────────────────────
  { description: "COSTCO WHSE #0474 GOLETA CA",          category: 'Groceries' },
  { description: "COSTCO #0293",                         category: 'Groceries' },
  { description: "SAM'S CLUB #0293",                     category: 'Groceries' },
  { description: "SAMS CLUB 1293 BENTONVILLE AR",        category: 'Groceries' },
  { description: "BJ'S WHOLESALE CLUB 0293",             category: 'Groceries' },

  // ── US Discount ───────────────────────────────────────────────────────────
  { description: "ALDI #0293",                           category: 'Groceries' },
  { description: "ALDI 1293 CINCINNATI OH",              category: 'Groceries' },
  { description: "LIDL #0293",                           category: 'Groceries' },
  { description: "LIDL US 1293",                         category: 'Groceries' },

  // ── US Online Grocery / Delivery ──────────────────────────────────────────
  { description: "INSTACART",                            category: 'Groceries' },
  { description: "IC* COSTCO BY INSTACAR",               category: 'Groceries' },
  { description: "IC* SAFEWAY VIA INSTACART",            category: 'Groceries' },
  { description: "SHIPT DELIVERY",                       category: 'Groceries' },
  { description: "AMAZON FRESH",                         category: 'Groceries' },
  { description: "FRESHLY MEALS",                        category: 'Groceries' },
  { description: "THRIVE MARKET",                        category: 'Groceries' },
  { description: "IMPERFECT FOODS",                      category: 'Groceries' },
  { description: "MISFITS MARKET",                       category: 'Groceries' },
  { description: "BUTCHERBOX",                           category: 'Groceries' },
  { description: "CROWD COW",                            category: 'Groceries' },
  { description: "GOOD EGGS DELIVERY",                   category: 'Groceries' },
  { description: "HUNGRYROOT",                           category: 'Groceries' },

  // ── UK Supermarkets ───────────────────────────────────────────────────────
  { description: "TESCO STORES 0293",                    category: 'Groceries' },
  { description: "TESCO #0293 LONDON",                   category: 'Groceries' },
  { description: "TESCO METRO 0293",                     category: 'Groceries' },
  { description: "SAINSBURY'S 0293",                     category: 'Groceries' },
  { description: "SAINSBURYS SUPERSTORE 1293",           category: 'Groceries' },
  { description: "ASDA #0293",                           category: 'Groceries' },
  { description: "ASDA STORES 1293 LEEDS",               category: 'Groceries' },
  { description: "MORRISONS 0293",                       category: 'Groceries' },
  { description: "WM MORRISON 1293",                     category: 'Groceries' },
  { description: "WAITROSE #0293",                       category: 'Groceries' },
  { description: "WAITROSE ESSENTIALS 1293",             category: 'Groceries' },
  { description: "OCADO RETAIL",                         category: 'Groceries' },
  { description: "OCADO.COM",                            category: 'Groceries' },
  { description: "ICELAND FOODS 0293",                   category: 'Groceries' },
  { description: "CO-OP FOOD 0293",                      category: 'Groceries' },
  { description: "THE CO-OPERATIVE FOOD 1293",           category: 'Groceries' },
  { description: "M&S FOOD 0293",                        category: 'Groceries' },
  { description: "MARKS AND SPENCER FOOD",               category: 'Groceries' },
  { description: "ALDI UK #0293",                        category: 'Groceries' },
  { description: "LIDL UK 0293",                         category: 'Groceries' },
  { description: "BUDGENS 0293",                         category: 'Groceries' },
  { description: "BOOTHS 0293",                          category: 'Groceries' },

  // ── Canadian Supermarkets ─────────────────────────────────────────────────
  { description: "LOBLAWS #0293",                        category: 'Groceries' },
  { description: "LOBLAWS SUPERSTORE 1293",              category: 'Groceries' },
  { description: "NO FRILLS #0293",                      category: 'Groceries' },
  { description: "FOOD BASICS 0293",                     category: 'Groceries' },
  { description: "SOBEYS #0293",                         category: 'Groceries' },
  { description: "IGA CANADA 0293",                      category: 'Groceries' },
  { description: "FRESHCO 0293",                         category: 'Groceries' },
  { description: "METRO GROCERY 0293",                   category: 'Groceries' },
  { description: "PROVIGO 0293",                         category: 'Groceries' },
  { description: "FARM BOY 0293",                        category: 'Groceries' },
  { description: "T&T SUPERMARKET 0293",                 category: 'Groceries' },
  { description: "BULK BARN #0293",                      category: 'Groceries' },

  // ── Australian / NZ Supermarkets ──────────────────────────────────────────
  { description: "WOOLWORTHS #0293",                     category: 'Groceries' },
  { description: "WOOLWORTHS SUPERMARKETS",              category: 'Groceries' },
  { description: "COLES SUPERMARKETS 0293",              category: 'Groceries' },
  { description: "COLES #0293 SYDNEY",                   category: 'Groceries' },
  { description: "IGA FOODWORKS 0293",                   category: 'Groceries' },
  { description: "FOODLAND 0293",                        category: 'Groceries' },
  { description: "HARRIS FARM MARKETS",                  category: 'Groceries' },
  { description: "COUNTDOWN SUPERMARKETS 0293",          category: 'Groceries' },
  { description: "PAK N SAVE 0293 AUCKLAND",             category: 'Groceries' },
  { description: "PAKNSAVE #0293",                       category: 'Groceries' },
  { description: "FOUR SQUARE NZ 0293",                  category: 'Groceries' },

  // ── Irish Supermarkets ────────────────────────────────────────────────────
  { description: "DUNNES STORES 0293",                   category: 'Groceries' },
  { description: "DUNNES STORES DUBLIN",                 category: 'Groceries' },
  { description: "SUPERVALU IRELAND 0293",               category: 'Groceries' },
  { description: "SUPERVALU #0293 CORK",                 category: 'Groceries' },
];

const TRANSPORTATION: SyntheticEntry[] = [
  // ── US Gas Stations ───────────────────────────────────────────────────────
  { description: "SHELL OIL 10008330010 DALLAS TX",      category: 'Transportation' },
  { description: "SHELL #0293",                          category: 'Transportation' },
  { description: "CHEVRON #0293 GOLETA CA",              category: 'Transportation' },
  { description: "CHEVRON 0192",                         category: 'Transportation' },
  { description: "EXXON MOBIL #0293",                    category: 'Transportation' },
  { description: "EXXON 1293 HOUSTON TX",                category: 'Transportation' },
  { description: "MOBIL #0293 LOS ANGELES CA",           category: 'Transportation' },
  { description: "MOBIL OIL 1293",                       category: 'Transportation' },
  { description: "BP #0293",                             category: 'Transportation' },
  { description: "BP GAS 1293 CHICAGO IL",               category: 'Transportation' },
  { description: "VALERO #0293",                         category: 'Transportation' },
  { description: "VALERO FUEL 1293",                     category: 'Transportation' },
  { description: "MARATHON #0293",                       category: 'Transportation' },
  { description: "MARATHON PETROLEUM 1293",              category: 'Transportation' },
  { description: "SUNOCO #0293",                         category: 'Transportation' },
  { description: "CIRCLE K #0293",                       category: 'Transportation' },
  { description: "CIRCLE K GAS 1293",                    category: 'Transportation' },
  { description: "SPEEDWAY #6378",                       category: 'Transportation' },
  { description: "QUIKTRIP #0293",                       category: 'Transportation' },
  { description: "WAWA #8012",                           category: 'Transportation' },
  { description: "RACETRAC #0293",                       category: 'Transportation' },
  { description: "PILOT FLYING J #0293",                 category: 'Transportation' },
  { description: "LOVE'S TRAVEL STOP #0293",             category: 'Transportation' },
  { description: "PHILLIPS 66 #0293",                    category: 'Transportation' },
  { description: "CONOCO #0293",                         category: 'Transportation' },
  { description: "ARCO #42720 AMPM CA",                  category: 'Transportation' },
  { description: "MURPHY USA #0293",                     category: 'Transportation' },
  { description: "CASEY'S GENERAL STORE 0293",           category: 'Transportation' },
  { description: "SHEETZ #0293",                         category: 'Transportation' },
  { description: "KWIK TRIP #0293",                      category: 'Transportation' },
  { description: "THORNTONS #0293",                      category: 'Transportation' },
  { description: "HOLIDAY STATIONSTORES 0293",           category: 'Transportation' },
  { description: "GETGO #0293",                          category: 'Transportation' },

  // ── UK / EU / International Gas ───────────────────────────────────────────
  { description: "ESSO #0293 LONDON",                    category: 'Transportation' },
  { description: "ESSO PETROLEUM 1293",                  category: 'Transportation' },
  { description: "TEXACO #0293",                         category: 'Transportation' },
  { description: "SHELL UK #0293",                       category: 'Transportation' },
  { description: "BP UK #0293",                          category: 'Transportation' },

  // ── Canadian Gas ──────────────────────────────────────────────────────────
  { description: "PETRO CANADA #0293",                   category: 'Transportation' },
  { description: "PETROCANADA 1293 TORONTO",             category: 'Transportation' },
  { description: "ULTRAMAR #0293",                       category: 'Transportation' },
  { description: "HUSKY GAS 0293",                       category: 'Transportation' },
  { description: "PIONEER GAS 0293",                     category: 'Transportation' },

  // ── Australia / NZ Gas ────────────────────────────────────────────────────
  { description: "AMPOL #0293 SYDNEY",                   category: 'Transportation' },
  { description: "AMPOL PETROLEUM 1293",                 category: 'Transportation' },
  { description: "CALTEX AUSTRALIA #0293",               category: 'Transportation' },
  { description: "PUMA ENERGY #0293",                    category: 'Transportation' },
  { description: "Z ENERGY #0293 WELLINGTON",            category: 'Transportation' },

  // ── Rideshare ─────────────────────────────────────────────────────────────
  { description: "UBER * TRIP",                          category: 'Transportation' },
  { description: "UBER TECHNOLOGIES",                    category: 'Transportation' },
  { description: "LYFT *RIDE",                           category: 'Transportation' },
  { description: "LYFT 855-865-9553",                    category: 'Transportation' },
  { description: "WAYMO ONE",                            category: 'Transportation' },
  { description: "DIDI CHUXING",                         category: 'Transportation' },    // AU/NZ/global
  { description: "OLA CABS LONDON",                      category: 'Transportation' },    // UK/AU/NZ
  { description: "BOLT RIDE DUBLIN",                     category: 'Transportation' },    // UK/IE/EU
  { description: "FREE NOW TAXI",                        category: 'Transportation' },    // UK/IE/EU

  // ── Car Rental ────────────────────────────────────────────────────────────
  { description: "ENTERPRISE RENT A CAR",                category: 'Transportation' },
  { description: "ENTERPRISE RAC 0293",                  category: 'Transportation' },
  { description: "HERTZ #0293",                          category: 'Transportation' },
  { description: "HERTZ RENTAL 1293",                    category: 'Transportation' },
  { description: "AVIS RENT A CAR #0293",                category: 'Transportation' },
  { description: "BUDGET CAR RENTAL 0293",               category: 'Transportation' },
  { description: "NATIONAL CAR RENTAL 0293",             category: 'Transportation' },
  { description: "ALAMO RENT A CAR 0293",                category: 'Transportation' },
  { description: "SIXT RENT A CAR 0293",                 category: 'Transportation' },
  { description: "TURO CAR RENTAL",                      category: 'Transportation' },
  { description: "ZIPCAR 0293",                          category: 'Transportation' },
  { description: "EUROPCAR 0293",                        category: 'Transportation' },
  { description: "DISCOUNT CAR RENTALS CA",              category: 'Transportation' },

  // ── Auto Services ─────────────────────────────────────────────────────────
  { description: "AUTOZONE #0293",                       category: 'Transportation' },
  { description: "JIFFY LUBE #0293",                     category: 'Transportation' },
  { description: "TOWING SERVICE 0293",                  category: 'Transportation' },
  { description: "FIRESTONE COMPLETE AUTO",              category: 'Transportation' },
  { description: "DISCOUNT TIRE #0293",                  category: 'Transportation' },
  { description: "LES SCHWAB TIRES 0293",                category: 'Transportation' },
  { description: "VALVOLINE OIL CHANGE",                 category: 'Transportation' },
  { description: "MIDAS #0293",                          category: 'Transportation' },
  { description: "PEP BOYS AUTO 0293",                   category: 'Transportation' },
  { description: "NAPA AUTO PARTS 0293",                 category: 'Transportation' },
  { description: "ADVANCE AUTO PARTS 0293",              category: 'Transportation' },
  { description: "OREILLY AUTO PARTS 0293",              category: 'Transportation' },
  { description: "GOODYEAR TIRE CENTER 0293",            category: 'Transportation' },
  { description: "MAVIS DISCOUNT TIRE 0293",             category: 'Transportation' },
  { description: "NTB #0293",                            category: 'Transportation' },
  { description: "JAVIER S OLD TOWN GARAGE GOLETA CA",   category: 'Transportation' },
  { description: "BROADWAY AUTO GARAGE",                 category: 'Transportation' },

  // ── EV Charging ───────────────────────────────────────────────────────────
  { description: "CHARGEPOINT CHARGING",                 category: 'Transportation' },
  { description: "ELECTRIFY AMERICA",                    category: 'Transportation' },
  { description: "EVGO #0293",                           category: 'Transportation' },
  { description: "TESLA SUPERCHARGER",                   category: 'Transportation' },
  { description: "BLINK CHARGING 0293",                  category: 'Transportation' },
  { description: "POD POINT LIMITED",                    category: 'Transportation' },    // UK
  { description: "BP PULSE CHARGE",                      category: 'Transportation' },    // UK
  { description: "CHARGEFOX #0293",                      category: 'Transportation' },    // AU

  // ── US Transit ────────────────────────────────────────────────────────────
  { description: "MTA METROCARD NEW YORK",               category: 'Transportation' },
  { description: "BART STATION TRANSIT",                 category: 'Transportation' },
  { description: "CTA CHICAGO TRANSIT",                  category: 'Transportation' },
  { description: "METRO TRANSIT MINNEAPOLIS",            category: 'Transportation' },
  { description: "METRA RAIL CHICAGO",                   category: 'Transportation' },
  { description: "AMTRAK #0293",                         category: 'Transportation' },
  { description: "GREYHOUND LINES 0293",                 category: 'Transportation' },
  { description: "MEGABUS US",                           category: 'Transportation' },
  { description: "FLIXBUS USA",                          category: 'Transportation' },
  { description: "WASHINGTON METRO WMATA",               category: 'Transportation' },
  { description: "MBTA CHARLIE CARD",                    category: 'Transportation' },
  { description: "SEPTA TRANSIT PHILADELPHIA",           category: 'Transportation' },

  // ── UK / Ireland Rail & Transit ───────────────────────────────────────────
  { description: "TRAINLINE.COM",                        category: 'Transportation' },
  { description: "THETRAINLINE 0293",                    category: 'Transportation' },
  { description: "TFL OYSTER 0293",                      category: 'Transportation' },
  { description: "TRANSPORT FOR LONDON",                 category: 'Transportation' },
  { description: "OYSTER CARD TOP UP",                   category: 'Transportation' },
  { description: "LNER TRAIN TICKETS",                   category: 'Transportation' },
  { description: "GWR GREAT WESTERN",                    category: 'Transportation' },
  { description: "AVANTI WEST COAST",                    category: 'Transportation' },
  { description: "STAGECOACH BUS 0293",                  category: 'Transportation' },
  { description: "NATIONAL EXPRESS 0293",                category: 'Transportation' },
  { description: "ARRIVA BUS LONDON",                    category: 'Transportation' },
  { description: "CROSSCOUNTRY TRAINS",                  category: 'Transportation' },
  { description: "IRISH RAIL 0293",                      category: 'Transportation' },
  { description: "IARNROD EIREANN",                      category: 'Transportation' },
  { description: "TRANSLINK NI 0293",                    category: 'Transportation' },

  // ── Canada Transit & Tolls ────────────────────────────────────────────────
  { description: "PRESTO CARD TOP UP",                   category: 'Transportation' },
  { description: "VIA RAIL CANADA",                      category: 'Transportation' },
  { description: "OC TRANSPO OTTAWA",                    category: 'Transportation' },
  { description: "407 ETR TOLL",                         category: 'Transportation' },
  { description: "TRANSLINK BC COMPASS",                 category: 'Transportation' },
  { description: "TTC TORONTO TRANSIT",                  category: 'Transportation' },

  // ── Australia / NZ Transit & Tolls ───────────────────────────────────────
  { description: "LINKT TOLLS",                          category: 'Transportation' },
  { description: "MYKI TOP UP MELBOURNE",                category: 'Transportation' },
  { description: "SMARTRIDER PERTH",                     category: 'Transportation' },
  { description: "OPAL CARD SYDNEY",                     category: 'Transportation' },
  { description: "AT HOP AUCKLAND",                      category: 'Transportation' },
  { description: "GO CARD BRISBANE",                     category: 'Transportation' },
  { description: "CITYLINK TOLLS MELBOURNE",             category: 'Transportation' },

  // ── US Tolls ──────────────────────────────────────────────────────────────
  { description: "E-ZPASS TOLL PAYMENT",                 category: 'Transportation' },
  { description: "SUNPASS TOLLS FL",                     category: 'Transportation' },
  { description: "FASTRAK TOLLS CA",                     category: 'Transportation' },
  { description: "PEACH PASS GEORGIA TOLLS",             category: 'Transportation' },

  // ── Parking ───────────────────────────────────────────────────────────────
  { description: "SPOTHERO PARKING",                     category: 'Transportation' },
  { description: "PARKWHIZ 0293",                        category: 'Transportation' },
  { description: "PAYBYPHONE PARKING",                   category: 'Transportation' },
  { description: "PARKMOBILE LLC",                       category: 'Transportation' },
  { description: "LAZ PARKING 0293",                     category: 'Transportation' },
  { description: "DOWNTOWN PARKING GARAGE",              category: 'Transportation' },
  { description: "CITY PARKING LOT 0293",                category: 'Transportation' },
  { description: "AIRPORT PARKING #0293",                category: 'Transportation' },
  { description: "RINGGO PARKING UK",                    category: 'Transportation' },    // UK
  { description: "NCP PARKING #0293",                    category: 'Transportation' },    // UK
  { description: "JUSTPARK 0293",                        category: 'Transportation' },    // UK
  { description: "QPARK #0293",                          category: 'Transportation' },    // UK/EU
  { description: "APCOA PARKING 0293",                   category: 'Transportation' },    // UK/EU

  // ── DMV / Registration ────────────────────────────────────────────────────
  { description: "DMV FEE REGISTRATION",                 category: 'Transportation' },
  { description: "CA DMV #0293",                         category: 'Transportation' },

  // ── Car Loan Payments ─────────────────────────────────────────────────────
  { description: "TOYOTA FINANCIAL SERVICES",            category: 'Transportation' },
  { description: "TOYOTA ACH RTL",                       category: 'Transportation' },
  { description: "HONDA FINANCIAL SERVICES",             category: 'Transportation' },
  { description: "FORD CREDIT",                          category: 'Transportation' },
  { description: "GM FINANCIAL",                         category: 'Transportation' },
  { description: "HYUNDAI CAPITAL AMERICA",              category: 'Transportation' },
  { description: "KIA MOTORS FINANCE",                   category: 'Transportation' },
  { description: "BMW FINANCIAL SERVICES",               category: 'Transportation' },
  { description: "VOLKSWAGEN CREDIT",                    category: 'Transportation' },
];

const ENTERTAINMENT: SyntheticEntry[] = [
  // ── Streaming Video ───────────────────────────────────────────────────────
  { description: "NETFLIX.COM",                          category: 'Entertainment' },
  { description: "NETFLIX 0293",                         category: 'Entertainment' },
  { description: "HULU",                                 category: 'Entertainment' },
  { description: "HULU.COM",                             category: 'Entertainment' },
  { description: "DISNEY PLUS",                          category: 'Entertainment' },
  { description: "DISNEY+",                              category: 'Entertainment' },
  { description: "DISNEYPLUS.COM",                       category: 'Entertainment' },
  { description: "HBO MAX",                              category: 'Entertainment' },
  { description: "MAX.COM",                              category: 'Entertainment' },
  { description: "HBO NOW",                              category: 'Entertainment' },
  { description: "PEACOCK TV",                           category: 'Entertainment' },
  { description: "NBCUNIVERSAL PEACOCK",                 category: 'Entertainment' },
  { description: "PARAMOUNT+",                           category: 'Entertainment' },
  { description: "PARAMOUNT PLUS",                       category: 'Entertainment' },
  { description: "PARAMOUNT STREAMING",                  category: 'Entertainment' },
  { description: "DISCOVERY+",                           category: 'Entertainment' },
  { description: "DISCOVERY PLUS",                       category: 'Entertainment' },
  { description: "APPLE TV+",                            category: 'Entertainment' },
  { description: "APPLE TV SUBSCRIPTION",                category: 'Entertainment' },
  { description: "AMAZON PRIME VIDEO",                   category: 'Entertainment' },
  { description: "PRIME VIDEO",                          category: 'Entertainment' },
  { description: "FUBO TV",                              category: 'Entertainment' },
  { description: "FUBOTV",                               category: 'Entertainment' },
  { description: "SLING TV",                             category: 'Entertainment' },
  { description: "YOUTUBE PREMIUM",                      category: 'Entertainment' },
  { description: "YOUTUBE TV",                           category: 'Entertainment' },
  { description: "PHILO TV",                             category: 'Entertainment' },
  { description: "DIRECTV STREAM",                       category: 'Entertainment' },
  { description: "BRITBOX",                              category: 'Entertainment' },    // UK/AU/CA
  { description: "BRITBOX.COM",                          category: 'Entertainment' },
  { description: "ACORN TV",                             category: 'Entertainment' },
  { description: "HAYU NOW TV",                          category: 'Entertainment' },    // UK
  { description: "NOW TV",                               category: 'Entertainment' },    // UK
  { description: "SKY GO",                               category: 'Entertainment' },    // UK
  { description: "STAN STREAMING AU",                    category: 'Entertainment' },    // AU
  { description: "BINGE AU",                             category: 'Entertainment' },    // AU
  { description: "KAYO SPORTS",                          category: 'Entertainment' },    // AU

  // ── Music ─────────────────────────────────────────────────────────────────
  { description: "SPOTIFY",                              category: 'Entertainment' },
  { description: "SPOTIFY USA",                          category: 'Entertainment' },
  { description: "APPLE MUSIC",                          category: 'Entertainment' },
  { description: "TIDAL HI-FI",                          category: 'Entertainment' },
  { description: "PANDORA",                              category: 'Entertainment' },
  { description: "PANDORA PLUS",                         category: 'Entertainment' },
  { description: "SIRIUS XM",                            category: 'Entertainment' },
  { description: "SIRIUSXM RADIO",                       category: 'Entertainment' },
  { description: "AMAZON MUSIC",                         category: 'Entertainment' },
  { description: "DEEZER",                               category: 'Entertainment' },    // global
  { description: "YOUTUBE MUSIC",                        category: 'Entertainment' },

  // ── Movies & Theaters ─────────────────────────────────────────────────────
  { description: "AMC THEATRES #0293",                   category: 'Entertainment' },
  { description: "AMC STUBS",                            category: 'Entertainment' },
  { description: "REGAL CINEMAS #0293",                  category: 'Entertainment' },
  { description: "CINEMARK #0293",                       category: 'Entertainment' },
  { description: "FANDANGO",                             category: 'Entertainment' },
  { description: "FANDANGO MOVIE TICKETS",               category: 'Entertainment' },
  { description: "ATOM TICKETS",                         category: 'Entertainment' },
  { description: "ODEON CINEMAS",                        category: 'Entertainment' },    // UK
  { description: "CINEWORLD #0293",                      category: 'Entertainment' },    // UK
  { description: "VUE CINEMAS",                          category: 'Entertainment' },    // UK
  { description: "EVENT CINEMAS AU",                     category: 'Entertainment' },    // AU
  { description: "HOYTS CINEMA 0293",                    category: 'Entertainment' },    // AU/NZ

  // ── Live Events & Tickets ─────────────────────────────────────────────────
  { description: "TICKETMASTER",                         category: 'Entertainment' },
  { description: "TICKETMASTER.COM",                     category: 'Entertainment' },
  { description: "STUBHUB",                              category: 'Entertainment' },
  { description: "VIVID SEATS",                          category: 'Entertainment' },
  { description: "SEATGEEK",                             category: 'Entertainment' },
  { description: "EVENTBRITE",                           category: 'Entertainment' },
  { description: "AXS TICKETS",                          category: 'Entertainment' },
  { description: "DICE MUSIC EVENTS",                    category: 'Entertainment' },    // UK/global
  { description: "SKIDDLE TICKETS",                      category: 'Entertainment' },    // UK
  { description: "TICKETEK AU",                          category: 'Entertainment' },    // AU/NZ

  // ── Gaming ────────────────────────────────────────────────────────────────
  { description: "STEAM GAMES",                          category: 'Entertainment' },
  { description: "STEAM PURCHASE",                       category: 'Entertainment' },
  { description: "PLAYSTATION NETWORK",                  category: 'Entertainment' },
  { description: "PSN DIGITAL",                          category: 'Entertainment' },
  { description: "XBOX GAME PASS",                       category: 'Entertainment' },
  { description: "MICROSOFT XBOX",                       category: 'Entertainment' },
  { description: "NINTENDO ESHOP",                       category: 'Entertainment' },
  { description: "NINTENDO.COM",                         category: 'Entertainment' },
  { description: "APPLE ARCADE",                         category: 'Entertainment' },
  { description: "GOOGLE PLAY GAMES",                    category: 'Entertainment' },
  { description: "EPIC GAMES",                           category: 'Entertainment' },
  { description: "TWITCH.TV",                            category: 'Entertainment' },
  { description: "ROBLOX ROBUX",                         category: 'Entertainment' },
  { description: "EA DIGITAL",                           category: 'Entertainment' },

  // ── Sports & Recreation ───────────────────────────────────────────────────
  { description: "ESPN+",                                category: 'Entertainment' },
  { description: "ESPN PLUS",                            category: 'Entertainment' },
  { description: "DAZN",                                 category: 'Entertainment' },    // global sport
  { description: "DAZN GROUP",                           category: 'Entertainment' },
  { description: "NBA LEAGUE PASS",                      category: 'Entertainment' },
  { description: "NFL SUNDAY TICKET",                    category: 'Entertainment' },
  { description: "MLB.TV",                               category: 'Entertainment' },
  { description: "BOWLING ALLEY 0293",                   category: 'Entertainment' },
  { description: "DAVE & BUSTERS 0293",                  category: 'Entertainment' },
  { description: "TOPGOLF 0293",                         category: 'Entertainment' },
  { description: "ROUND1 ARCADE",                        category: 'Entertainment' },
  { description: "MINI GOLF WORLD",                      category: 'Entertainment' },
  { description: "ESCAPE ROOM ADVENTURES",               category: 'Entertainment' },
  { description: "DISNEYLAND RESORT",                    category: 'Entertainment' },
  { description: "UNIVERSAL STUDIOS",                    category: 'Entertainment' },
  { description: "SIX FLAGS",                            category: 'Entertainment' },
];

const SHOPPING: SyntheticEntry[] = [
  // ── US Online Retail ──────────────────────────────────────────────────────
  { description: "AMAZON MKTPL*BS89T8J61",               category: 'Shopping' },
  { description: "AMAZON.COM",                           category: 'Shopping' },
  { description: "AMAZON PRIME MEMBERSHIP",              category: 'Shopping' },
  { description: "EBAY INC",                             category: 'Shopping' },
  { description: "EBAY #0293",                           category: 'Shopping' },
  { description: "ETSY.COM",                             category: 'Shopping' },
  { description: "WISH.COM",                             category: 'Shopping' },
  { description: "WAYFAIR",                              category: 'Shopping' },
  { description: "OVERSTOCK.COM",                        category: 'Shopping' },
  { description: "SHEIN",                                category: 'Shopping' },
  { description: "TEMU",                                 category: 'Shopping' },

  // ── US Department Stores ──────────────────────────────────────────────────
  { description: "TARGET #0293",                         category: 'Shopping' },
  { description: "TARGET CORP",                          category: 'Shopping' },
  { description: "WALMART #0293",                        category: 'Shopping' },
  { description: "WALMART.COM",                          category: 'Shopping' },
  { description: "MACY'S #0293",                         category: 'Shopping' },
  { description: "MACYS COM",                            category: 'Shopping' },
  { description: "NORDSTROM #0293",                      category: 'Shopping' },
  { description: "BLOOMINGDALE'S 0293",                  category: 'Shopping' },
  { description: "KOHL'S #0293",                         category: 'Shopping' },
  { description: "DILLARD'S #0293",                      category: 'Shopping' },
  { description: "BELK #0293",                           category: 'Shopping' },
  { description: "JC PENNEY #0293",                      category: 'Shopping' },
  { description: "BURLINGTON COAT 0293",                 category: 'Shopping' },
  { description: "T.J. MAXX #0293",                      category: 'Shopping' },
  { description: "MARSHALLS #0293",                      category: 'Shopping' },
  { description: "ROSS DRESS FOR LESS 0293",             category: 'Shopping' },

  // ── US Home & Hardware ────────────────────────────────────────────────────
  { description: "HOME DEPOT #0293",                     category: 'Shopping' },
  { description: "HOME DEPOT 1293",                      category: 'Shopping' },
  { description: "LOWES #0293",                          category: 'Shopping' },
  { description: "LOWE'S HOME IMPROVEMENT",              category: 'Shopping' },
  { description: "IKEA US",                              category: 'Shopping' },
  { description: "IKEA #0293",                           category: 'Shopping' },
  { description: "BED BATH BEYOND 0293",                 category: 'Shopping' },
  { description: "CRATE AND BARREL 0293",                category: 'Shopping' },
  { description: "WILLIAMS SONOMA 0293",                 category: 'Shopping' },
  { description: "POTTERY BARN 0293",                    category: 'Shopping' },
  { description: "RESTORATION HARDWARE",                 category: 'Shopping' },
  { description: "ACE HARDWARE #0293",                   category: 'Shopping' },
  { description: "HARBOR FREIGHT 0293",                  category: 'Shopping' },

  // ── US Electronics ────────────────────────────────────────────────────────
  { description: "BEST BUY #0293",                       category: 'Shopping' },
  { description: "BEST BUY 1293",                        category: 'Shopping' },
  { description: "APPLE STORE",                          category: 'Shopping' },
  { description: "APPLE.COM",                            category: 'Shopping' },
  { description: "MICROSOFT STORE",                      category: 'Shopping' },
  { description: "B&H PHOTO",                            category: 'Shopping' },
  { description: "ADORAMA",                              category: 'Shopping' },
  { description: "NEWEGG",                               category: 'Shopping' },

  // ── US Clothing / Fashion ─────────────────────────────────────────────────
  { description: "H&M #0293",                            category: 'Shopping' },
  { description: "H AND M 1293",                         category: 'Shopping' },
  { description: "ZARA #0293",                           category: 'Shopping' },
  { description: "GAP #0293",                            category: 'Shopping' },
  { description: "GAP ONLINE",                           category: 'Shopping' },
  { description: "BANANA REPUBLIC 0293",                 category: 'Shopping' },
  { description: "OLD NAVY #0293",                       category: 'Shopping' },
  { description: "FOREVER 21 0293",                      category: 'Shopping' },
  { description: "EXPRESS 0293",                         category: 'Shopping' },
  { description: "AMERICAN EAGLE 0293",                  category: 'Shopping' },
  { description: "ABERCROMBIE 0293",                     category: 'Shopping' },
  { description: "HOLLISTER CO 0293",                    category: 'Shopping' },
  { description: "UNIQLO 0293",                          category: 'Shopping' },
  { description: "ANTHROPOLOGIE 0293",                   category: 'Shopping' },
  { description: "FREE PEOPLE 0293",                     category: 'Shopping' },
  { description: "LULULEMON 0293",                       category: 'Shopping' },
  { description: "NIKE.COM",                             category: 'Shopping' },
  { description: "NIKE #0293",                           category: 'Shopping' },
  { description: "ADIDAS",                               category: 'Shopping' },
  { description: "FOOT LOCKER 0293",                     category: 'Shopping' },

  // ── UK / AU Shopping ──────────────────────────────────────────────────────
  { description: "MARKS AND SPENCER 0293",               category: 'Shopping' },
  { description: "M&S 0293",                             category: 'Shopping' },
  { description: "JOHN LEWIS 0293",                      category: 'Shopping' },
  { description: "NEXT RETAIL 0293",                     category: 'Shopping' },
  { description: "PRIMARK 0293",                         category: 'Shopping' },
  { description: "ASOS.COM",                             category: 'Shopping' },
  { description: "BOOHOO.COM",                           category: 'Shopping' },
  { description: "ARGOS 0293",                           category: 'Shopping' },
  { description: "CURRYS PC WORLD",                      category: 'Shopping' },
  { description: "AMAZON UK",                            category: 'Shopping' },
  { description: "JB HI FI AU",                         category: 'Shopping' },
  { description: "HARVEY NORMAN AU",                    category: 'Shopping' },
  { description: "KMART AUSTRALIA",                      category: 'Shopping' },
  { description: "BIG W AUSTRALIA",                     category: 'Shopping' },
];

const HEALTH: SyntheticEntry[] = [
  // ── US Pharmacies ─────────────────────────────────────────────────────────
  { description: "CVS PHARMACY #0293",                   category: 'Health' },
  { description: "CVS #1293",                            category: 'Health' },
  { description: "WALGREENS #0293",                      category: 'Health' },
  { description: "WALGREENS 1293",                       category: 'Health' },
  { description: "RITE AID #0293",                       category: 'Health' },
  { description: "RITE AID PHARMACY 1293",               category: 'Health' },
  { description: "DUANE READE #0293",                    category: 'Health' },
  { description: "BARTELL DRUGS 0293",                   category: 'Health' },
  { description: "MEIJER PHARMACY 0293",                 category: 'Health' },

  // ── US Healthcare ─────────────────────────────────────────────────────────
  { description: "URGENT CARE CENTER 0293",              category: 'Health' },
  { description: "CONCENTRA URGENT CARE",                category: 'Health' },
  { description: "NEXTCARE URGENT CARE",                 category: 'Health' },
  { description: "KAISER PERMANENTE",                    category: 'Health' },
  { description: "CIGNA HEALTH 0293",                    category: 'Health' },
  { description: "UNITED HEALTHCARE",                    category: 'Health' },
  { description: "AETNA INSURANCE",                      category: 'Health' },
  { description: "LABCORP 0293",                         category: 'Health' },
  { description: "QUEST DIAGNOSTICS",                    category: 'Health' },
  { description: "AMERICAN FAMILY CARE",                 category: 'Health' },
  { description: "PATIENT FIRST 0293",                   category: 'Health' },
  { description: "PLANNED PARENTHOOD",                   category: 'Health' },
  { description: "DENTAL ASSOCIATES 0293",               category: 'Health' },
  { description: "ASPEN DENTAL 0293",                    category: 'Health' },
  { description: "VISION WORKS 0293",                    category: 'Health' },
  { description: "LENSCRAFTERS 0293",                    category: 'Health' },
  { description: "WARBY PARKER 0293",                    category: 'Health' },
  { description: "AMERICA'S BEST CONTACTS",              category: 'Health' },

  // ── US Fitness ────────────────────────────────────────────────────────────
  { description: "PLANET FITNESS #0293",                 category: 'Health' },
  { description: "LA FITNESS 0293",                      category: 'Health' },
  { description: "24 HOUR FITNESS",                      category: 'Health' },
  { description: "GOLD'S GYM 0293",                      category: 'Health' },
  { description: "EQUINOX #0293",                        category: 'Health' },
  { description: "CRUNCH FITNESS 0293",                  category: 'Health' },
  { description: "ANYTIME FITNESS 0293",                 category: 'Health' },
  { description: "LIFETIME FITNESS",                     category: 'Health' },
  { description: "PURE BARRE 0293",                      category: 'Health' },
  { description: "ORANGETHEORY FITNESS",                 category: 'Health' },
  { description: "CROSSFIT AFFINITY",                    category: 'Health' },
  { description: "PELOTON INTERACTIVE",                  category: 'Health' },
  { description: "PELOTON.COM",                          category: 'Health' },
  { description: "MIRROR FITNESS",                       category: 'Health' },
  { description: "CLASSPASS",                            category: 'Health' },
  { description: "MINDBODY INC",                         category: 'Health' },
  { description: "STRAVA PREMIUM",                       category: 'Health' },
  { description: "NOOM INC",                             category: 'Health' },
  { description: "BEACHBODY",                            category: 'Health' },

  // ── Mental Health / Telehealth ────────────────────────────────────────────
  { description: "BETTERHELP",                           category: 'Health' },
  { description: "TALKSPACE",                            category: 'Health' },
  { description: "HEADSPACE",                            category: 'Health' },
  { description: "CALM APP",                             category: 'Health' },
  { description: "TELADOC",                              category: 'Health' },
  { description: "MDLive",                               category: 'Health' },
  { description: "SESAMECARE",                           category: 'Health' },

  // ── UK / CA / AU Pharmacies & Health ──────────────────────────────────────
  { description: "BOOTS PHARMACY 0293",                  category: 'Health' },
  { description: "BOOTS #0293 LONDON",                   category: 'Health' },
  { description: "LLOYDS PHARMACY 0293",                 category: 'Health' },
  { description: "SUPERDRUG 0293",                       category: 'Health' },
  { description: "BUPA UK",                              category: 'Health' },
  { description: "NHS PRESCRIPTION",                     category: 'Health' },
  { description: "SHOPPERS DRUG MART CA",                category: 'Health' },
  { description: "REXALL PHARMACY CA",                   category: 'Health' },
  { description: "PRICELINE PHARMACY AU",                category: 'Health' },
  { description: "CHEMIST WAREHOUSE AU",                 category: 'Health' },
  { description: "TERRY WHITE CHEMMART",                 category: 'Health' },
  { description: "LIFE PHARMACY NZ",                     category: 'Health' },
];

// ---------------------------------------------------------------------------
// Build full corpus
// ---------------------------------------------------------------------------

const ALL_SYNTHETIC: SyntheticEntry[] = [
  ...FOOD,
  ...GROCERIES,
  ...TRANSPORTATION,
  ...ENTERTAINMENT,
  ...SHOPPING,
  ...HEALTH,
];

// ---------------------------------------------------------------------------
// Real CSV parsing
// ---------------------------------------------------------------------------

const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const CSV_FILES = [
  'Last year (2025).CSV',
  'Year to date.CSV',
  'Since Apr 03, 2026.CSV',
];

function parseCSV(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').slice(1); // skip header
  const descriptions: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // Format: Status,Date,"Description",Debit,Credit,Member Name
    const match = /"([^"]+)"/.exec(line);
    if (match) descriptions.push(match[1].trim());
    else {
      const parts = line.split(',');
      if (parts.length >= 3 && parts[2]) descriptions.push(parts[2].trim());
    }
  }
  return descriptions;
}

// Keyword-to-category lookup for auto-categorizing real CSV transactions
// Higher entries in each list take priority
const CATEGORY_KEYWORDS: Array<{ patterns: string[]; category: string }> = [
  // Food & Dining — delivery + processor prefix first, then chains, then lexicon
  { patterns: ['doordash', 'dd *', 'grubhub', 'uber eats', 'ubereats', 'postmates', 'seamless',
               'deliveroo', 'just eat', 'skip the dishes', 'skipthedishes', 'menulog',
               'hellofresh', 'hello fresh', 'blue apron', 'home chef', 'everyplate', 'green chef',
               'sunbasket', 'factor 75', 'dinnerly', 'marley spoon', 'gopuff', 'ezcater',
               'tst*', 'tst *'], category: 'Food & Dining' },
  { patterns: ["mcdonald", "burger king", "wendy", "taco bell", "chick fil", "chik fil",
               "popeyes", "kfc", "sonic", "jack in the box", "hardee", "carl's jr", "carls jr",
               "del taco", "whataburger", "in n out", "five guys", "shake shack", "raising cane",
               "wingstop", "culver", "white castle", "cook out", "zaxby", "bojangle",
               "church's chicken", "el pollo loco", "checkers", "steak n shake",
               "chipotle", "panera", "sweetgreen", "cava", "mod pizza", "noodles", "qdoba",
               "moes southwest", "panda express", "potbelly", "which wich", "firehouse subs",
               "jersey mike", "jason's deli", "einstein bros", "boston market",
               "domino", "pizza hut", "papa john", "little caesars", "cicis", "marcos pizza",
               "starbucks", "dunkin", "dutch bros", "peet's", "caribou coffee", "coffee bean",
               "krispy kreme", "cinnabon", "auntie anne", "dairy queen", "cold stone",
               "baskin robbins", "pinkberry", "menchies", "yogurtland", "jamba juice",
               "smoothie king", "tropical smoothie", "crumbl", "insomnia cookies",
               "applebee", "chili's", "chilis", "olive garden", "red lobster", "outback",
               "texas roadhouse", "longhorn", "tgi friday", "ruby tuesday", "denny's", "dennys",
               "ihop", "waffle house", "cracker barrel", "cheesecake factory", "p.f. chang",
               "buffalo wild wings", "red robin", "nandos", "nando's", "pret a manger",
               "wagamama", "itsu", "wasabi sushi", "costa coffee", "caffe nero",
               "tim hortons", "harvey's", "swiss chalet", "hungry jacks", "red rooster",
               "guzman", "oporto", "supermac", "eddie rocket",
               "freebirds", "waba grill", "flame broiler"], category: 'Food & Dining' },
  { patterns: ['cafe', 'coffee', 'bakery', 'bagel', 'deli', 'pizza', 'taqueria',
               'bistro', 'diner', 'tavern', 'grill', ' bbq', 'donut', 'brewing',
               'creamery', 'ice cream', 'restaurant', 'eatery', 'food truck',
               'sushi', 'ramen', 'pho ', 'noodle', 'teriyaki', 'gyro', 'espresso',
               'catering', 'kebab', 'wok', 'steakhouse', 'smokehouse', 'dumpling',
               'dim sum', 'peri peri', 'boba', 'caffe', 'brasserie', 'takeaway',
               'chippy', 'vegan bowl'], category: 'Food & Dining' },

  // Groceries — warehouse clubs and major chains first
  { patterns: ['costco', "sam's club", "sams club", 'bj\'s wholesale',
               'whole foods', 'trader joe', 'sprouts', 'fresh market',
               'kroger', 'safeway', 'albertsons', 'publix', 'heb', 'meijer',
               'giant food', 'giant eagle', 'stop & shop', 'stop and shop',
               'wegmans', 'harris teeter', 'food lion', 'winn dixie', 'winn-dixie',
               'piggly wiggly', 'vons', 'ralphs', 'fred meyer', 'king soopers',
               'fry\'s food', 'frys food', 'smith\'s food', 'smiths food',
               'dillons', 'qfc', 'jewel-osco', 'jewel osco', 'randalls', 'tom thumb',
               'acme markets', 'shaw\'s', 'shaws', 'hannaford', 'price chopper',
               'market basket', 'ingles', 'shoprite', 'food4less', 'food 4 less',
               'smart & final', 'smart and final', 'grocery outlet', 'winco', 'raley',
               'hy-vee', 'hy vee', 'fareway', 'stater bros', 'bashas', 'food city',
               'aldi', 'lidl',
               'instacart', 'ic* ', 'shipt', 'amazon fresh',
               'thrive market', 'imperfect foods', 'misfits market', 'butcherbox', 'crowd cow',
               'tesco', "sainsbury", 'asda', 'morrisons', 'waitrose', 'ocado', 'iceland foods',
               'co-op food', 'the co-operative', 'm&s food', 'marks and spencer food', 'budgens', 'booths',
               'loblaws', 'no frills', 'food basics', 'sobeys', 'iga canada', 'freshco',
               'metro grocery', 'provigo', 'farm boy', 't&t supermarket', 'bulk barn',
               'woolworths', 'coles', 'foodland', 'harris farm', 'countdown', 'pak n save',
               'paknsave', 'four square', 'dunnes stores', 'dunnes', 'supervalu'],
    category: 'Groceries' },

  // Transportation
  { patterns: ['shell', 'chevron', 'exxon', 'mobil ', 'bp gas', 'bp #', 'bp 0', 'bp fuel',
               'valero', 'marathon petro', 'sunoco', 'circle k', 'speedway', 'quiktrip',
               'wawa', 'racetrac', 'pilot flying', "love's travel", 'phillips 66', 'conoco',
               'arco', 'murphy usa', 'murphy express', "casey's general", 'sheetz',
               'esso', 'texaco', 'petro canada', 'petrocanada', 'ultramar', 'ampol', 'caltex',
               'puma energy', 'z energy',
               'uber', 'lyft', 'waymo', 'didi chux', 'ola cabs', 'bolt ride',
               'enterprise rent', 'hertz', 'avis rent', 'budget car', 'national car', 'alamo',
               'sixt rent', 'turo', 'zipcar', 'europcar',
               'autozone', 'jiffy lube', 'firestone', 'discount tire', 'les schwab', 'valvoline',
               'midas', 'pep boys', 'napa auto', 'advance auto', 'oreilly auto', 'o reilly auto',
               'goodyear tire', 'mavis discount',
               'chargepoint', 'electrify america', 'evgo', 'tesla supercharger', 'blink charging',
               'dmv',
               'amtrak', 'greyhound', 'megabus', 'trainline', 'tfl ', 'oyster card',
               'presto card', 'via rail', 'linkt', 'myki', 'opal card',
               'e-zpass', 'sunpass', 'fastrak',
               'parking', 'spothero', 'parkwhiz', 'paybyphone', 'parkmobile',
               'toyota financial', 'toyota ach', 'honda financial', 'ford credit',
               'gm financial', 'hyundai capital', 'kia motors finance', 'bmw financial',
               'volkswagen credit'], category: 'Transportation' },

  // Entertainment
  { patterns: ['netflix', 'hulu', 'disney plus', 'disney+', 'disneyplus', 'hbo max', 'hbo now',
               'max.com', 'peacock', 'paramount+', 'paramount plus', 'discovery+', 'apple tv',
               'amazon prime video', 'prime video', 'fubo', 'sling tv', 'youtube premium',
               'youtube tv', 'britbox', 'acorn tv', 'now tv', 'sky go', 'stan streaming',
               'binge au', 'kayo sports',
               'spotify', 'apple music', 'tidal', 'pandora', 'sirius xm', 'siriusxm',
               'amazon music', 'deezer',
               'amc theatre', 'amc stubs', 'regal cinema', 'cinemark', 'fandango', 'atom tickets',
               'odeon', 'cineworld', 'vue cinema', 'event cinema', 'hoyts',
               'ticketmaster', 'stubhub', 'vivid seats', 'seatgeek', 'eventbrite', 'axs ticket',
               'steam game', 'steam purchase', 'playstation', 'psn digital', 'xbox game pass',
               'microsoft xbox', 'nintendo', 'apple arcade', 'epic games', 'twitch', 'roblox',
               'espn+', 'espn plus', 'dazn', 'nba league pass', 'nfl sunday ticket', 'mlb.tv',
               'dave & busters', 'topgolf', 'disneyland', 'universal studio'], category: 'Entertainment' },

  // Shopping
  { patterns: ['amazon mktpl', 'amazon.com', 'amazon prime', 'ebay', 'etsy', 'wayfair',
               'overstock', 'shein', 'temu',
               'home depot', 'lowes', "lowe's", 'ikea', 'bed bath', 'crate and barrel',
               'williams sonoma', 'pottery barn', 'ace hardware', 'harbor freight',
               'best buy', 'apple store', 'apple.com', 'microsoft store',
               'target corp', 'target #', 'walmart', "macy's", 'macys', 'nordstrom',
               "bloomingdale", "kohl's", "dillard's", 'belk', 'jc penney', 'tj maxx', 'marshalls',
               'ross dress', 'burlington coat',
               'h&m', 'zara', 'gap', 'banana republic', 'old navy', 'forever 21', 'express',
               'american eagle', 'abercrombie', 'hollister', 'uniqlo', 'lululemon',
               'nike.com', 'nike #', 'adidas', 'foot locker',
               'marks and spencer', 'm&s', 'john lewis', 'next retail', 'primark', 'asos',
               'argos', 'currys', 'jb hi fi', 'harvey norman', 'kmart australia', 'big w'],
    category: 'Shopping' },

  // Health — check before Shopping so "CVS" pharmacy doesn't slip through
  { patterns: ['cvs pharmacy', 'cvs/', 'cvs #', 'cvspharmacy', 'walgreen', 'rite aid',
               'duane reade', 'bartell drug', 'express scripts', 'caremark', 'optumrx', 'goodrx',
               'urgent care', 'concentra', 'nextcare', 'kaiser', 'cigna', 'united healthcare',
               'unitedhealth', 'aetna', 'anthem', 'humana', 'blue cross', 'bluecross',
               'labcorp', 'quest diagnostics', 'aspen dental', 'dental office', 'planned parenthood',
               'vision works', 'lenscrafters', 'warby parker', "america's best contacts",
               'planet fitness', 'la fitness', '24 hour fitness', "gold's gym", 'golds gym',
               'equinox', 'crunch fitness', 'anytime fitness', 'lifetime fitness',
               'pure barre', 'orangetheory', 'crossfit', 'f45 training', 'soulcycle',
               'peloton', 'classpass', 'mindbody', 'strava', 'ymca',
               'betterhelp', 'talkspace', 'headspace', 'calm app', 'teladoc', 'mdlive', 'sesamecare',
               'noom', 'beachbody', 'mirror fitness',
               'boots pharmacy', 'lloyds pharmacy', 'superdrug', 'bupa', 'nhs ',
               'shoppers drug mart', 'rexall', 'priceline pharmacy', 'chemist warehouse',
               'terry white'],
    category: 'Health' },
];

function autoCategorize(description: string): string {
  const lower = description.toLowerCase();
  for (const { patterns, category } of CATEGORY_KEYWORDS) {
    for (const p of patterns) {
      if (lower.includes(p)) return category;
    }
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// Load real CSV transactions
// ---------------------------------------------------------------------------

const seenDescriptions = new Set<string>();

function makeId(index: number): string {
  return `tx-${index.toString().padStart(6, '0')}`;
}

let txIndex = 0;
const transactions: any[] = [];

// 1. Synthetic transactions
for (const entry of ALL_SYNTHETIC) {
  const key = entry.description.toLowerCase();
  if (seenDescriptions.has(key)) continue;
  seenDescriptions.add(key);

  transactions.push({
    id: makeId(txIndex++),
    account_id: 'global-test-account',
    description: entry.description,
    amount_cents: -1200,
    category_id: CAT_ID[entry.category] ?? CAT_ID['Other'],
    category_set_manually: 0,
    dropped_at: null,
  });
}

// 2. Real CSV transactions (de-duplicated by description)
let realCount = 0;
const realSkipped: string[] = [];

for (const csvFile of CSV_FILES) {
  const filePath = path.join(DOWNLOADS, csvFile);
  const descriptions = parseCSV(filePath);

  for (const desc of descriptions) {
    if (!desc) continue;
    const key = desc.toLowerCase();
    if (seenDescriptions.has(key)) {
      realSkipped.push(desc);
      continue;
    }
    seenDescriptions.add(key);

    const category = autoCategorize(desc);

    transactions.push({
      id: makeId(txIndex++),
      account_id: 'global-test-account',
      description: desc,
      amount_cents: -1200,
      category_id: CAT_ID[category],
      category_set_manually: 0,
      dropped_at: null,
    });
    realCount++;
  }
}

// ---------------------------------------------------------------------------
// Build backup object
// ---------------------------------------------------------------------------

const backup = {
  transactions,
  categories: CATEGORIES,
  rules: [],
};

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const OUTPUT = path.join(__dirname, 'global-test-backup.json');
fs.writeFileSync(OUTPUT, JSON.stringify(backup, null, 2));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const byCategory: Record<string, number> = {};
for (const tx of transactions) {
  const catName = CATEGORIES.find(c => c.id === tx.category_id)?.name ?? 'Unknown';
  byCategory[catName] = (byCategory[catName] ?? 0) + 1;
}

console.log(`\nGlobal test backup written to: ${OUTPUT}`);
console.log(`\nTotal transactions: ${transactions.length}`);
console.log(`  Synthetic: ${transactions.length - realCount}`);
console.log(`  Real CSV:  ${realCount} (${realSkipped.length} duplicates skipped)`);
console.log(`\nBreakdown by category:`);
for (const [name, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(20)} ${count}`);
}
