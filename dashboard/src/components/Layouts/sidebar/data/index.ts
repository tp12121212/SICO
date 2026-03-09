import * as Icons from "../icons";

export const NAV_DATA = [
  {
    label: "SICO",
    items: [
      {
        title: "Testing",
        icon: Icons.HomeIcon,
        items: [
          {
            title: "Text Extraction",
            url: "/testing/test-text-extraction"
          },
          {
            title: "Test Data Classification",
            url: "/testing/test-data-classification"
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
      },
      {
        title: "Build",
        icon: Icons.Alphabet,
        items: [
          {
            title: "SIT Builder",
            url: "/build/sit-builder"
          },
          {
            title: "DLP Builder",
            url: "/build/dlp-builder"
          }
        ]
      }
    ]
  }
];
