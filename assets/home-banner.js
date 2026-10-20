// Keep the original book artwork; only the surrounding banner lettering changes.
const bannerControls = [...document.querySelectorAll("[data-banner-grade]")];
for (const control of bannerControls) {
  control.addEventListener("click", () => {
    const product = PRODUCTS.find((item) => item.title === `Graad ${control.dataset.bannerGrade}`);
    if (!product) return;
    const productPath = `/product/${product.slug}/`;
    document.querySelector("#banner-grade").textContent = product.title;
    document.querySelector("#banner-cover").src = product.images[0];
    document.querySelector("#banner-cover").alt = `${product.title} Afrikaans-werkboek`;
    document.querySelector("#banner-cover-link").href = productPath;
    document.querySelector("#banner-book-link").href = productPath;
    document.querySelectorAll(".workbook-banner-samples img").forEach((image, index) => {
      image.src = product.images[index + 1];
      image.alt = `${product.title} voorbeeldbladsy ${index + 1}`;
    });
    for (const button of bannerControls) button.setAttribute("aria-pressed", String(button === control));
  });
}
