// Phase categories — predefined list + freeform support
export const PREDEFINED_CATEGORIES = [
  "Real Estate",
  "Permitting",
  "Excavating",
  "Framing",
  "HVAC",
  "Plumbing",
  "Siding",
  "Electrical",
  "Concrete",
  "Paint",
  "Interior Finishes",
];

export const getDefaultCategories = (): string[] => PREDEFINED_CATEGORIES;

export const sortPhasesByCategory = (phases: any[]) => {
  const grouped: { [key: string]: any[] } = {};
  const categorized: any[] = [];
  const uncategorized: any[] = [];

  // Separate by category
  phases.forEach((phase) => {
    if (!phase.category) {
      uncategorized.push(phase);
    } else {
      if (!grouped[phase.category]) {
        grouped[phase.category] = [];
      }
      grouped[phase.category].push(phase);
    }
  });

  // Sort phases within each category by start date
  Object.keys(grouped).forEach((cat) => {
    grouped[cat].sort((a, b) => {
      const aDate = a.startDate ? new Date(a.startDate) : new Date(9999, 0, 0);
      const bDate = b.startDate ? new Date(b.startDate) : new Date(9999, 0, 0);
      return aDate.getTime() - bDate.getTime();
    });
  });

  // Sort uncategorized by start date
  uncategorized.sort((a, b) => {
    const aDate = a.startDate ? new Date(a.startDate) : new Date(9999, 0, 0);
    const bDate = b.startDate ? new Date(b.startDate) : new Date(9999, 0, 0);
    return aDate.getTime() - bDate.getTime();
  });

  // Build result as array of {category, phases}
  Object.keys(grouped).forEach((cat) => {
    categorized.push({ category: cat, phases: grouped[cat] });
  });

  if (uncategorized.length > 0) {
    categorized.push({ category: "Uncategorized", phases: uncategorized });
  }

  return categorized;
};

export const sortPhasesByDate = (phases: any[]) => {
  return [...phases].sort((a, b) => {
    const aDate = a.startDate ? new Date(a.startDate) : new Date(9999, 0, 0);
    const bDate = b.startDate ? new Date(b.startDate) : new Date(9999, 0, 0);
    return aDate.getTime() - bDate.getTime();
  });
};
