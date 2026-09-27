import http from "node:http";

const PORT = Number(process.env.STORE_BRAND_QA_API_PORT || 4100);

const networks = [
  ["instagram", "https://instagram.com/awj"],
  ["x", "https://x.com/awj"],
  ["tiktok", "https://www.tiktok.com/@awj"],
  ["snapchat", "https://www.snapchat.com/add/awj"],
  ["youtube", "https://www.youtube.com/@awj"],
  ["linkedin", "https://www.linkedin.com/company/awj"],
  ["facebook", "https://www.facebook.com/awj"],
];

const presentation = {
  version: 2,
  branding: { displayName: "Al Noor" },
  header: { showCategoryNav: false },
  homepage: {
    sections: [{ id: "app-1", type: "appPromo", visible: true }],
  },
  footer: {
    tagline: "Eastern Province",
    showLogo: true,
    copyright: "",
  },
  contact: {
    phone: "+966500000001",
    email: "shop@example.com",
    address: "Dammam, Eastern Province",
    hours: "9:00–21:00",
  },
  whatsapp: {
    enabled: true,
    phone: "+966500000000",
    message: "",
    placement: "both",
  },
  social: networks.map(([network, url]) => ({
    id: network,
    network,
    url,
    enabled: true,
  })),
  verification: {
    licenseNumber: "LIC-42",
  },
  sbc: {
    show_in_storefront: false,
  },
  apps: {
    iosUrl: "https://apps.apple.com/app/id000000000",
    androidUrl: "https://play.google.com/store/apps/details?id=sa.awj",
    appName: "Al Noor",
    showHomepageSection: true,
    showFooterLinks: true,
  },
};

const storefront = {
  data: {
    name: "Al Noor",
    default_locale: null,
    business_identity: {
      legal_name: "Al Noor Trading Company",
      cr_number: "7050247977",
      vat_number: "310123456700003",
    },
    presentation,
  },
};

const json = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

    if (url.pathname === "/store/v1/storefront") {
      return json(res, storefront);
    }
    if (url.pathname === "/store/v1/categories") {
      return json(res, { data: [] });
    }
    if (url.pathname === "/store/v1/products") {
      return json(res, { data: [], meta: {} });
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  })
  .listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`store-brand QA API fixture listening on ${PORT}\n`);
  });
