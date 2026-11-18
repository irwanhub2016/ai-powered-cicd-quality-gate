# Notes: Scaling & Improvements Architecture Guide
> **Senior SDET Technical Notes — PayMongo Automation Challenge**
> *Dokumen referensi persiapan interview teknis: analisis skalabilitas, arsitektur masa depan, dan mitigasi risiko.*

---

## 📌 Executive Summary
Repo automation saat ini sudah memenuhi *core requirements* assessment dengan implementasi:
- Multi-model fallback chain (`gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.6-flash`).
- AST compiler dan Swagger guardrails (`ts.createSourceFile`) untuk memvalidasi output sebelum disimpan.
- Deterministic temperature (`0.1`) dan Playwright selector best-practices.
- Intelligent generated-test cache dengan fingerprint SHA-256 dan verifikasi output.
- Zero-modification pada template config Playwright.

Namun, untuk membawa arsitektur ini ke tingkat **Enterprise / Production-Ready** (misal melayani 100+ microservices atau 1,000+ endpoint di sistem payment), berikut adalah roadmap perbaikan dan skalabilitas yang dapat dipresentasikan saat interview:

---

## 🚀 1. Intelligent Caching & Spec-Diffing (Efisiensi Waktu & Token Cost)

### Implementasi Saat Ini
1. **Content Fingerprint (SHA-256):** Hash mencakup Swagger JSON, frontend component, prompt, generator, semantic guardrail, dan lockfile TypeScript.
2. **Cached Output Verification:** Manifest menyimpan hash output API dan web. Cache hanya dipakai jika seluruh file tersedia, salinan hasil konsisten, checksum cocok, dan validasi AST/Swagger lolos kembali.
3. **GitHub Actions Cache:** `actions/cache` menyimpan generated tests dan manifest berdasarkan hash input. Jika input berubah, key berubah dan LLM dipanggil kembali.
4. **Safe Fallback:** Cache miss, file output berubah/hilang, atau validasi gagal akan menjalankan generator seperti biasa. Pada cache hit, Gemini API key tidak dibutuhkan.

Cache ini menghindari panggilan LLM yang sia-sia; ia tidak membuktikan bahwa isi test menguji perilaku service secara benar. Tetap jalankan generated tests di quality gate.

---

## 🧩 2. OpenAPI Spec Chunking / Tag Partitioning (Skala Ratusan Endpoint)

### Masalah Saat Ini
File `swagger.yaml` dimasukkan secara monolitik (satu file utuh) ke prompt generator, menghasilkan satu file `generated-api.spec.ts`.
- **Dampak:** Di payment gateway riil (seperti PayMongo), file OpenAPI bisa mencapai puluhan ribu baris dengan ratusan endpoint. Mengirim satu file raksasa akan melampaui context window atau memicu fenomena LLM *"lost-in-the-middle"* (melewatkan endpoint tertentu).

### Solusi Skalabilitas
1. **OpenAPI Parser & Splitting:**
   - Gunakan library seperti `@readme/openapi-parser` atau `swagger-parser`.
   - Pecah spesifikasi berdasarkan `tags` (misal: `/auth`, `/payments`, `/refunds`, `/webhooks`, `/disputes`).
2. **Parallel Generation Pool:**
   - Eksekusi pemanggilan LLM secara paralel (`Promise.allSettled`) per grup endpoint.
3. **Modular Output Files:**
   - Output dibagi ke dalam file terpisah:
     - `tests/api/auth.spec.ts`
     - `tests/api/payments.spec.ts`
     - `tests/api/refunds.spec.ts`
   - Memudahkan CI menjalankan test secara modular atau ter-shard.

---

## 🛡️ 3. Semantic Validation & Mutation Testing (Guardrail Lanjutan)

### Masalah Saat Ini
Guardrail saat ini adalah **AST Syntax Validation** menggunakan TypeScript compiler API. Ini menjamin kode tidak memiliki kesalahan kompilasi (syntax error, missing brackets, dll), tetapi belum memvalidasi apakah assertion-nya *bermakna secara semantik*.

### Solusi Skalabilitas
1. **Endpoint Conformance Checker (Anti-Hallucination):**
   - Buat AST visitor (`ts.forEachChild`) yang mengekstrak semua string URL di `request.get(...)` / `request.post(...)`.
   - Cocokkan URL tersebut dengan daftar `paths` di `swagger.yaml`. Jika LLM mengarang endpoint fiktif, tolak kode sebelum disimpan.
2. **Assertion Density & Quality Gate:**
   - Tolak test jika hanya mengandung *tautology* (seperti `expect(true).toBe(true)`). Wajibkan minimal:
     - Assertion HTTP status code.
     - Assertion tipe data schema body.
3. **Mutation Testing (Fault Injection):**
   - Jalankan mutation testing (misal Stryker Mutator atau script fault injection internal): sengaja ubah response status backend menjadi error.
   - Jika test AI tetap lolos (*mutant survives*), tandai test suite tersebut sebagai *unreliable* karena assertion-nya terlalu longgar.

---

## ⚡ 4. CI Test Sharding & Parallel Execution (Kecepatan Eksekusi)

### Masalah Saat Ini
Di `playwright.config.ts`, runner CI diset dengan `workers: 1` (serial) agar stabil di VM single core. Jika jumlah test berkembang menjadi 500+ test, waktu eksekusi akan memakan waktu 20–40 menit.

### Solusi Skalabilitas
1. **GitHub Actions Matrix Sharding:**
   ```yaml
   strategy:
     fail-fast: false
     matrix:
       shardIndex: [1, 2, 3, 4]
       shardTotal: [4]
   steps:
     - name: Run Playwright Tests (Shard ${{ matrix.shardIndex }}/${{ matrix.shardTotal }})
       run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
   ```
2. **Merged Report Artifacts:**
   - Gabungkan laporan dari keempat shard menggunakan perintah `npx playwright merge-reports` untuk menghasilkan satu Playwright HTML Report terpadu.
   - Memangkas durasi CI hingga 75%.

---

## 🐳 5. Containerization (Docker Compose Test Harness)

### Masalah Saat Ini
Service Go backend dan Next.js frontend di-start langsung di OS host (menggunakan port 8080 dan 3000), yang rentan terhadap konflik port dan perbedaan versi Node/Go antara mesin lokal developer dengan runner CI.

### Solusi Skalabilitas
1. **`docker-compose.test.yml`:**
   - Satukan service backend Go, frontend Next.js, dan runner Playwright dalam isolated network.
   - Menggunakan image resmi `mcr.microsoft.com/playwright:v1.40.0-jammy`.
2. **Keuntungan:**
   - 100% reproduktif (*hermetic testing*). Menghilangkan problem *"it works on my machine"*.
   - Port tidak akan bentrok dengan aplikasi lokal lainnya.

---

## 🔄 6. Arsitektur Shift-Left: "PR Bot" vs "Dynamic CI Generation"

### Poin Diskusi Krusial untuk Interview
Interviewer sering menanyakan apakah aman men-generate test di dalam CI runner secara *ephemeral*.

### Perbandingan Pendekatan:
| Parameter | Dynamic Generation di CI (Challenge Mode) | Shift-Left PR Bot (Enterprise Gold Standard) |
| :--- | :--- | :--- |
| **Lokasi Generate** | Di dalam ephemeral CI runner saat PR build. | Di level GitHub PR sebelum code merge. |
| **Ketergantungan API** | Setiap build bergantung pada koneksi/kuota LLM. | CI build tidak butuh akses/kunci LLM. |
| **Review Manusia** | Tidak ada review manusia pada kode test yang digenerate. | SDET me-review kode test di PR review (Human-in-the-loop). |
| **Determinisme** | Berpotensi flaky jika LLM output sedikit berubah. | 100% deterministik dan traceable di Git history. |

### Alur Kerja Shift-Left yang Direkomendasikan:
1. Developer mengubah API specification (`docs/swagger.yaml`) dan membuka PR.
2. GitHub Workflow memicu **AI Test Assistant Bot**:
   - Membaca git diff swagger.
   - Men-generate test baru.
   - Melakukan commit balik ke branch PR atau membuka automated comment diff test.
3. SDET melakukan inspeksi dan verifikasi.
4. CI Gate hanya bertugas menjalankan test yang sudah tersimpan di Git repository.

---

## 📊 Summary Cheatsheet untuk Jawaban Interview

```
"Jika saya membawa arsitektur ini ke level enterprise di PayMongo:
 1. Cost & Speed   -> Content-hash caching & Git diff triggers (jangan panggil LLM jika spec tidak berubah).
 2. Scale           -> OpenAPI tag chunking & parallel generation untuk ratusan endpoint.
 3. Reliability     -> Semantic conformance checking (anti-halusinasi) & mutation testing.
 4. Execution Speed -> Playwright CI matrix sharding (4x parallel VM).
 5. Architecture    -> Evolusi dari dynamic CI generation ke Shift-Left PR Bot dengan Human-in-the-loop review."
```
