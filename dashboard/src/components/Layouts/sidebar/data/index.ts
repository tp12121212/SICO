import * as Icons from "../icons";

export const NAV_DATA = [
  {
    label: "SICO",
    items: [
      {
        title: "Test Text Extraction",
        icon: Icons.HomeIcon,
        items: [
          {
            title: "Run Extraction",
            url: "/"
          }
        ]
      },
      {
        title: "Purview Recipes",
        icon: Icons.Table,
        items: [
          {
            title: "SIT Library",
            url: "/purview-recipes/sit-library"
          },
          {
            title: "DLP Library",
            url: "/purview-recipes/dlp-library"
          }
        ]
      }
    ]
  }
];
