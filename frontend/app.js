const API_BASE = 'http://127.0.0.1:8000'

const el = id => document.getElementById(id)

let idA = null
let idB = null
let resultState = null
const historyA = []
const historyB = []
let playTimer = null
let isPlaying = false
const playSteps = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]

async function postJSON(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(txt)
  }
  return res.json()
}

async function generate(target) {
  setMsg('')
  stopInterpolationPlayback()
  clearFilmstrip()
  try {
    const data = await postJSON('/generate', {})
    if (target === 'A') {
      idA = data.latent_id
      el('imgA').src = data.image
      historyA.push({ id: idA, image: data.image })
      if (historyA.length > 1) el('undoA').disabled = false
    } else {
      idB = data.latent_id
      el('imgB').src = data.image
      historyB.push({ id: idB, image: data.image })
      if (historyB.length > 1) el('undoB').disabled = false
    }
    updateButtons()
    return data
  } catch (e) {
    setMsg('Generation error: ' + e.message)
    throw e
  }
}

function clearFilmstrip() {
  const container = el('interpResults')
  if (!container) return
  container.innerHTML = ''
}

function updatePlayButton() {
  const btn = el('playInterp')
  if (!btn) return
  btn.textContent = isPlaying ? 'Stop' : 'Play interpolation'
}

function stopInterpolationPlayback() {
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
  isPlaying = false
  updatePlayButton()
}

function setMsg(text) { el('msg').textContent = text }
function setInterpMsg(text) { el('interpMsg').textContent = text }
function setFormula(text) { const f = el('formula'); if (f) f.textContent = text }
function setInterpFormula(w) { setFormula(`z_out = (1-w)·z_A + w·z_B   (w = ${Number(w).toFixed(2)})`) }
function setWeightVal(v) { el('weightVal').textContent = Number(v).toFixed(2) }

function setResult(latentId, image) {
  resultState = latentId && image ? { id: latentId, image } : null
  el('imgOut').src = image || ''
  if (el('useOutA')) el('useOutA').disabled = !resultState
  if (el('useOutB')) el('useOutB').disabled = !resultState
}

async function doOp(op) {
  setMsg('')
  if (!idA || !idB) {
    setMsg('Generate both A and B first')
    return
  }
  try {
    const payload = { id_a: idA, id_b: idB, operation: op }
    const data = await postJSON('/arithmetic', payload)
    setResult(data.latent_id, data.image)
    if (op === 'add') setFormula('A + B')
    if (op === 'subtract_ab') setFormula('A - B')
    if (op === 'subtract_ba') setFormula('B - A')
  } catch (e) {
    setMsg('Operation error: ' + e.message)
  }
}

async function doInterp() {
  setInterpMsg('')
  stopInterpolationPlayback()
  if (!idA || !idB) {
    setInterpMsg('Generate both A and B first')
    return
  }
  try {
    await getFilmstrip()
    const w = Number(el('weight').value)
    const res = await postJSON('/interpolate', { id_a: idA, id_b: idB, weight: w })
    if (res && res.image) {
      setResult(res.latent_id, res.image)
      setInterpFormula(w)
      highlightSelectedAlpha(w)
    }
    setInterpMsg('')
  } catch (e) {
    setInterpMsg('Interpolation error: ' + e.message)
  }
}

let interpTimeout = null
async function getFilmstrip() {
  if (!idA || !idB) return
  try {
    const res = await postJSON('/interpolate', { id_a: idA, id_b: idB, steps: 7 })
    if (res && res.images) {
      renderFilmstrip(res.images, res.alphas)
    }
  } catch (e) {
    console.warn('Failed to load filmstrip', e)
  }
}

function renderFilmstrip(images, alphas) {
  const container = el('interpResults')
  if (!container) return
  container.innerHTML = ''
  images.forEach((src, i) => {
    const fig = document.createElement('figure')
    fig.className = 'interp-thumb'
    const img = document.createElement('img')
    img.src = src
    img.alt = `interp ${i}`
    img.dataset.alpha = alphas ? alphas[i] : ''
    img.addEventListener('click', () => {
      const a = Number(img.dataset.alpha || 0.5)
      el('weight').value = String(a)
      setWeightVal(a)
      triggerWeightedUpdate()
      highlightSelectedAlpha(a)
    })
    const cap = document.createElement('figcaption')
    cap.textContent = alphas ? `${alphas[i].toFixed(2)}` : ''
    fig.appendChild(img)
    fig.appendChild(cap)
    container.appendChild(fig)
  })
  const cur = Number(el('weight').value)
  highlightSelectedAlpha(cur)
}

function highlightSelectedAlpha(weight) {
  const container = el('interpResults')
  if (!container) return
  const figs = container.querySelectorAll('.interp-thumb')
  figs.forEach(f => {
    const img = f.querySelector('img')
    const a = Number(img.dataset.alpha || 0)
    if (Math.abs(a - weight) < 0.005) f.classList.add('selected')
    else f.classList.remove('selected')
  })
}

function triggerWeightedUpdate() {
  if (interpTimeout) clearTimeout(interpTimeout)
  interpTimeout = setTimeout(async () => {
    interpTimeout = null
    const w = Number(el('weight').value)
    if (!idA || !idB) return
    try {
      const res = await postJSON('/interpolate', { id_a: idA, id_b: idB, weight: w })
      if (res && res.image) {
        setResult(res.latent_id, res.image)
        setInterpFormula(w)
        highlightSelectedAlpha(w)
      }
    } catch (e) {
      setInterpMsg('Interpolation error: ' + e.message)
    }
  }, 120)
}

function clearOut() {
  stopInterpolationPlayback()
  setResult(null, '')
  setFormula('z_out = (1 - w) * z_A + w * z_B   (w = 0.50)')
}

async function refreshInterpolationViews() {
  if (!idA || !idB) return
  await getFilmstrip()
  triggerWeightedUpdate()
}

function stepToWeight(weight) {
  el('weight').value = String(weight)
  setWeightVal(weight)
  triggerWeightedUpdate()
  highlightSelectedAlpha(weight)
}

function playInterpolation() {
  if (isPlaying) {
    stopInterpolationPlayback()
    return
  }
  if (!idA || !idB) {
    setInterpMsg('Generate both A and B first')
    return
  }

  stopInterpolationPlayback()
  isPlaying = true
  updatePlayButton()
  setInterpMsg('')

  let index = 0
  const current = Number(el('weight').value)
  const foundIndex = playSteps.findIndex(step => Math.abs(step - current) < 0.01)
  if (foundIndex >= 0 && foundIndex < playSteps.length - 1) index = foundIndex

  const tick = () => {
    const weight = playSteps[index]
    stepToWeight(weight)
    if (!isPlaying) return
    if (index >= playSteps.length - 1) {
      stopInterpolationPlayback()
      return
    }
    index += 1
    playTimer = setTimeout(tick, 450)
  }

  tick()
}

async function useResultAs(target) {
  if (!resultState) {
    setMsg('Generate a result first')
    return
  }
  clearFilmstrip()
  if (target === 'A') {
    idA = resultState.id
    el('imgA').src = resultState.image
    historyA.push({ id: idA, image: resultState.image })
  } else {
    idB = resultState.id
    el('imgB').src = resultState.image
    historyB.push({ id: idB, image: resultState.image })
  }
  updateButtons()
  await refreshInterpolationViews()
}

function updateButtons() {
  const enabled = idA && idB
  el('opAdd').disabled = !enabled
  el('opSubAB').disabled = !enabled
  el('opSubBA').disabled = !enabled
  el('doInterp').disabled = !enabled
  if (el('useOutA')) el('useOutA').disabled = !resultState
  if (el('useOutB')) el('useOutB').disabled = !resultState
  if (el('undoA')) el('undoA').disabled = historyA.length <= 1
  if (el('undoB')) el('undoB').disabled = historyB.length <= 1
}

async function randomizeBoth() {
  try {
    stopInterpolationPlayback()
    await generate('A')
    await generate('B')
    await getFilmstrip()
    triggerWeightedUpdate()
  } catch (err) {
    setMsg('Random generation failed: ' + (err.message || err))
  }
}

document.addEventListener('DOMContentLoaded', () => {
  el('genA').addEventListener('click', () => generate('A'))
  el('genB').addEventListener('click', () => generate('B'))
  el('undoA').addEventListener('click', () => {
    if (historyA.length <= 1) return
    historyA.pop()
    const prev = historyA[historyA.length - 1]
    idA = prev.id
    el('imgA').src = prev.image
    updateButtons()
  })
  el('undoB').addEventListener('click', () => {
    if (historyB.length <= 1) return
    historyB.pop()
    const prev = historyB[historyB.length - 1]
    idB = prev.id
    el('imgB').src = prev.image
    updateButtons()
  })
  el('opAdd').addEventListener('click', () => doOp('add'))
  el('opSubAB').addEventListener('click', () => doOp('subtract_ab'))
  el('opSubBA').addEventListener('click', () => doOp('subtract_ba'))
  el('weight').addEventListener('input', ev => { setWeightVal(ev.target.value); triggerWeightedUpdate() })
  el('doInterp').addEventListener('click', doInterp)
  el('playInterp').addEventListener('click', playInterpolation)
  el('useOutA').addEventListener('click', () => { void useResultAs('A') })
  el('useOutB').addEventListener('click', () => { void useResultAs('B') })
  el('clearOut').addEventListener('click', clearOut)
  el('randomBoth').addEventListener('click', randomizeBoth)

  setWeightVal(el('weight').value)
  setFormula('z_out = (1 - w) * z_A + w * z_B   (w = 0.50)')
  updatePlayButton()
  updateButtons()

  ;(async () => {
    try {
      setMsg('Generating initial images...')
      el('opAdd').disabled = true
      el('opSubAB').disabled = true
      el('opSubBA').disabled = true
      el('doInterp').disabled = true
      await generate('A')
      await generate('B')
      await getFilmstrip()
      triggerWeightedUpdate()
      setMsg('')
    } catch (err) {
      setMsg('Initial generation failed: ' + (err.message || err))
    } finally {
      updateButtons()
    }
  })()
})
