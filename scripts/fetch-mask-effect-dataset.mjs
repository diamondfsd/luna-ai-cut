/* global process */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetRoot = path.join(repositoryRoot, 'test-data', 'color-masking', 'd3-effect-set')
const manifestPath = path.join(datasetRoot, 'manifest.json')
const resolveSources = process.argv.includes('--resolve-sources')

const seeds = [
  ['sky-01', 'sky', 'https://commons.wikimedia.org/wiki/File:Blue_Mountains_National_Park_(AU),_Three_Sisters_--_2019_--_1987-9.jpg', 'mountain boundary against sky'],
  ['sky-02', 'sky', 'https://commons.wikimedia.org/wiki/File:Cloud_cumulonimbus_at_baltic_sea(1).jpg', 'cloud and sea with similar tones'],
  ['sky-03', 'sky', 'https://commons.wikimedia.org/wiki/File:Cirrus_front_over_Austnesfjorden,_Austv%C3%A5g%C3%B8ya,_Lofoten,_Norway,_2015_April.jpg', 'thin cirrus clouds and gradient sky'],
  ['sky-04', 'sky', 'https://commons.wikimedia.org/wiki/File:Blue_stormy_clouds_at_sunset_with_water_reflection_and_a_pirogue_moored_to_the_bank,_in_Don_Det,_Laos.jpg', 'dark storm clouds and reflection'],
  ['sky-05', 'sky', 'https://commons.wikimedia.org/wiki/File:Blue_and_orange_clouds_over_the_Mekong_with_a_pirogue_running_in_the_water_at_sunset_in_Don_Det_Laos.jpg', 'multicolor sunset and horizon'],
  ['sky-06', 'sky', 'https://commons.wikimedia.org/wiki/File:Bridge_to_Don_Khon_seen_from_Don_Det_with_water_reflection_of_stringy_orange_clouds_at_sunrise_in_Laos.jpg', 'bridge structures crossing sky'],
  ['sky-07', 'sky', 'https://commons.wikimedia.org/wiki/File:A_foggy_winter_morning.jpg', 'fog and low-contrast horizon'],
  ['sky-08', 'sky', 'https://commons.wikimedia.org/wiki/File:Buff_Theatre_SPB_01.jpg', 'urban building occlusion'],
  ['water-01', 'water', 'https://commons.wikimedia.org/wiki/File:Ocean_waves_beach.jpg', 'foam and broken shoreline'],
  ['water-02', 'water', 'https://commons.wikimedia.org/wiki/File:Nanga_Parbat_Reflection_Lake.jpg', 'mirror reflection and mountain'],
  ['water-03', 'water', 'https://commons.wikimedia.org/wiki/File:Li_Phi_falls_at_dusk_with_colorful_sky_and_clouds_in_Don_Khon_Laos.jpg', 'waterfall and low light'],
  ['water-04', 'water', 'https://commons.wikimedia.org/wiki/File:Lindau_Harbor_Lake_Constance_MS_Schwaben_01.jpg', 'boats and harbor occlusion'],
  ['water-05', 'water', 'https://commons.wikimedia.org/wiki/File:Frozen_Sevan_lake_with_ice_broken,_February_2017.jpg', 'water, ice and cracks'],
  ['water-06', 'water', 'https://commons.wikimedia.org/wiki/File:Water_reflection_of_mountains_and_hut_in_a_paddy_field_with_blue_sky_in_Vang_Vieng,_Laos.jpg', 'shallow paddy water and vegetation'],
  ['water-07', 'water', 'https://commons.wikimedia.org/wiki/File:Colorful_sky_with_orange_clouds_reflecting_in_the_water_of_a_paddy_field,_at_sunset,_Vang_Vieng,_Laos.jpg', 'warm reflection and low-contrast bank'],
  ['water-08', 'water', 'https://commons.wikimedia.org/wiki/File:Banya_yeonji_pond_water_reflection_of_bridge_and_trees_under_blue_sky_at_Bulguksa_Gyeongju_South_Korea.jpg', 'bridge, trees and reflection'],
  ['person-01', 'person', 'https://commons.wikimedia.org/wiki/File:A_touareg_at_the_Festival_au_Desert_near_Timbuktu,_Mali_2012.jpg', 'loose clothing and headwear'],
  ['person-02', 'person', 'https://commons.wikimedia.org/wiki/File:20151030_Syrians_and_Iraq_refugees_arrive_at_Skala_Sykamias_Lesvos_Greece_2.jpg', 'overlapping people and occlusion'],
  ['person-03', 'person', 'https://commons.wikimedia.org/wiki/File:A_bad_sales_day.jpg', 'seated pose and surrounding objects'],
  ['person-04', 'person', 'https://commons.wikimedia.org/wiki/File:20160805_Inle_Lake_7434.jpg', 'small distant person on water'],
  ['person-05', 'person', 'https://commons.wikimedia.org/wiki/File:A_girl_set_fire_to_cook_breakfast_by_using_a_coal-filled_clay_pot;_July_2014.jpg', 'smoke, tools and limb occlusion'],
  ['person-06', 'person', 'https://commons.wikimedia.org/wiki/File:A_man_and_his_donkey_on_the_way_back_from_the_field_in_Aswan,_Egypt_(edited).jpg', 'person adjacent to animal'],
  ['person-07', 'person', 'https://commons.wikimedia.org/wiki/File:20180924_UCI_Road_World_Championships_Innsbruck_Men_U23_ITT_Callum_Scotson_850_8281.jpg', 'cycling pose and thin limbs'],
  ['person-08', 'person', 'https://commons.wikimedia.org/wiki/File:Street_Crowd.jpg', 'dense crowd and multiple scales'],
  ['subject-01', 'subject', 'https://commons.wikimedia.org/wiki/File:Dalmatian_fetching_a_stick.jpg', 'motion, fur and thin limbs'],
  ['subject-02', 'subject', 'https://commons.wikimedia.org/wiki/File:Erfurt_-_Th%C3%BCringer_Zoopark_-_Rhea_americana_01.jpg', 'feathers and thin legs'],
  ['subject-03', 'subject', 'https://commons.wikimedia.org/wiki/File:2016_Kwiat_grzybieni_bia%C5%82ych_2.jpg', 'petal edges over water'],
  ['subject-04', 'subject', 'https://commons.wikimedia.org/wiki/File:1957_Volkswagen_Beetle,_export_model,_in_front_of_Porta_Nigra_in_Trier_2023-05-01.jpg', 'reflective car and architecture'],
  ['subject-05', 'subject', 'https://commons.wikimedia.org/wiki/File:Bicycle_reflections.jpg', 'spokes, holes and reflections'],
  ['subject-06', 'subject', 'https://commons.wikimedia.org/wiki/File:Beige_and_brown_oil-paper_umbrella_on_the_edge_of_a_wooden_house_in_Luang_Prabang_Laos.jpg', 'umbrella ribs and similar colors'],
  ['subject-07', 'subject', 'https://commons.wikimedia.org/wiki/File:2017_Odbiornik_radiowy_%C5%9Awiatowid.jpg', 'hard indoor object and shadow'],
  ['subject-08', 'subject', 'https://commons.wikimedia.org/wiki/File:Barania_G%C3%B3ra_-_observation_tower.jpg', 'open structure and background holes'],
  ['tree-01', 'tree', 'https://commons.wikimedia.org/wiki/File:Alnus_glutinosa_02_by-dpc.jpg', 'dense leaves and broken outline'],
  ['tree-02', 'tree', 'https://commons.wikimedia.org/wiki/File:Acacia_in_Ein_Khadra_Desert_Oasis_00_(87).jpg', 'isolated tree on bright desert'],
  ['tree-03', 'tree', 'https://commons.wikimedia.org/wiki/File:Albizia_saman_trunk_leaning_over_the_water_on_a_Mekong_bank_in_sunshine_at_golden_hour_(2).jpg', 'leaning trunk, water and backlight'],
  ['tree-04', 'tree', 'https://commons.wikimedia.org/wiki/File:Bad_Wimpfen_-_LSG_Altenberg-Mittelberg_-_Streuobstwiese_mit_Raureif.jpg', 'overlapping frosted trees'],
  ['tree-05', 'tree', 'https://commons.wikimedia.org/wiki/File:Bad_Rappenau_-_Bonfeld_-_M%C3%BChlberg_-_Eiche_s%C3%BCdlich_vom_Weg_im_November_mit_Gegenlicht.jpg', 'backlit sparse branches'],
  ['tree-06', 'tree', 'https://commons.wikimedia.org/wiki/File:20250706_Drago_de_San_Antonio_02.jpg', 'unusual crown and branching trunk'],
  ['tree-07', 'tree', 'https://commons.wikimedia.org/wiki/File:Aekingerzand_Nationaal_Park_Drents-Friese_Wold._11-08-2025._(actm.)_09.jpg', 'multiple trees blending into grass'],
  ['tree-08', 'tree', 'https://commons.wikimedia.org/wiki/File:Baum_in_K%C3%A4rnten_037.jpg', 'fog and low-contrast outline'],
]

async function runCurl(args) {
  const { stdout } = await execFileAsync('curl', [
    '--fail',
    '--location',
    '--retry', '4',
    '--retry-all-errors',
    '--connect-timeout', '20',
    '--max-time', '120',
    '--user-agent', 'LunaAiCutTestDataset/1.0',
    ...args,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

function titleFromSourcePage(sourcePage) {
  return decodeURIComponent(new URL(sourcePage).pathname.replace('/wiki/', '')).replaceAll('_', ' ')
}

function normalizedTitle(title) {
  return title.normalize('NFKC').replaceAll('_', ' ').trim().toLocaleLowerCase('en')
}

async function resolveCommonsImages() {
  const requestedTitles = seeds.map(([, , sourcePage]) => titleFromSourcePage(sourcePage))
  const stdout = await runCurl([
    'https://commons.wikimedia.org/w/api.php',
    '--data-urlencode', 'action=query',
    '--data-urlencode', 'format=json',
    '--data-urlencode', 'prop=imageinfo',
    '--data-urlencode', 'iiprop=url|mime|size|extmetadata',
    '--data-urlencode', 'iiurlwidth=1280',
    '--data-urlencode', `titles=${requestedTitles.join('|')}`,
  ])
  const response = JSON.parse(stdout)
  const pagesByTitle = new Map(Object.values(response.query?.pages ?? {}).map((page) => [normalizedTitle(page.title), page]))
  return seeds.map(([, , sourcePage]) => {
    const requestedTitle = titleFromSourcePage(sourcePage)
    const page = pagesByTitle.get(normalizedTitle(requestedTitle))
    if (!page || page.missing !== undefined) throw new Error(`Wikimedia Commons file is missing: ${sourcePage}`)
    const info = page.imageinfo[0]
    if (info?.mime !== 'image/jpeg' || !info.thumburl || info.thumbwidth < 640 || info.thumbheight < 360) {
      throw new Error(`Wikimedia Commons file is not a suitable JPEG: ${sourcePage}`)
    }
    return {
      sourceTitle: page.title,
      sourcePage: info.descriptionurl,
      downloadUrl: info.thumburl,
      sourceLicense: info.extmetadata?.LicenseShortName?.value ?? 'See source page',
      sourceArtist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '',
      width: info.thumbwidth,
      height: info.thumbheight,
    }
  })
}

async function sha256(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

async function downloadFile(url, destination) {
  const temporaryPath = `${destination}.download`
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(temporaryPath, { force: true })
  await runCurl(['--output', temporaryPath, url])
  await rename(temporaryPath, destination)
}

async function createManifest() {
  const items = []
  const sources = await resolveCommonsImages()
  for (const [index, [id, target, , coverage]] of seeds.entries()) {
    const source = sources[index]
    const relativePath = `images/${target}/${id}.jpg`
    const destination = path.join(datasetRoot, relativePath)
    await downloadFile(source.downloadUrl, destination)
    const fileStats = await stat(destination)
    items.push({
      id,
      target,
      coverage,
      file: relativePath,
      ...source,
      bytes: fileStats.size,
      sha256: await sha256(destination),
    })
    process.stdout.write(`resolved ${id}: ${source.sourceTitle}\n`)
  }
  const manifest = {
    schemaVersion: 1,
    name: 'Luna AI Cut D3 color masking effect set',
    source: 'Wikimedia Commons',
    imagePolicy: 'Fixed 1280px thumbnails; do not silently replace failures or change expected hashes.',
    items,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'))
}

async function restoreAndVerify(manifest) {
  for (const item of manifest.items) {
    const destination = path.join(datasetRoot, item.file)
    let actualHash = null
    try {
      actualHash = await sha256(destination)
    } catch {
      // Missing files are restored from the fixed manifest URL below.
    }
    if (actualHash !== item.sha256) {
      await downloadFile(item.downloadUrl, destination)
      actualHash = await sha256(destination)
    }
    if (actualHash !== item.sha256) {
      throw new Error(`Hash mismatch for ${item.id}; source changed, keep the failure visible`)
    }
    process.stdout.write(`verified ${item.id}\n`)
  }
}

await mkdir(datasetRoot, { recursive: true })
let manifest
if (resolveSources) {
  manifest = await createManifest()
} else {
  try {
    manifest = await loadManifest()
  } catch (error) {
    throw new Error(`Manifest missing. Run this script once with --resolve-sources. ${error.message}`)
  }
}
await restoreAndVerify(manifest)
