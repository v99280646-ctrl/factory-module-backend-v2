import { ServiceModel } from "../models/service.model.js";

const DEFAULT_FACTORY_SERVICES = [
  {
    code: "PRESSING",
    name: "Pressing Mechine",
    price: 0,
    unit: "piece",
    employeeRole: "Pressing Mechine",
  },
  {
    code: "CUTTING",
    name: "Cutting Mechine",
    price: 0,
    unit: "piece",
    employeeRole: "Cutting Mechine",
  },
  {
    code: "EDGEBAND",
    name: "Edge Band Mechine",
    price: 0,
    unit: "piece",
    employeeRole: "Edge Band Mechine",
  },
  {
    code: "BORING",
    name: "Boring Mechine",
    price: 0,
    unit: "piece",
    employeeRole: "Boring Mechine",
  },
  {
    code: "PACKING_DELIVERY",
    name: "Packing & Delivery",
    price: 0,
    unit: "piece",
    employeeRole: "Packing & Delivery",
  },
];

export async function ensureDefaultFactoryServices(factoryId, actorId = null) {
  if (!factoryId) {
    return [];
  }

  await Promise.all(
    DEFAULT_FACTORY_SERVICES.map((service) =>
      ServiceModel.updateOne(
        { factoryId, code: service.code },
        {
          $setOnInsert: {
            factoryId,
            createdBy: actorId,
            updatedBy: actorId,
            active: true,
            ...service,
          },
        },
        { upsert: true }
      )
    )
  );

  return ServiceModel.find({ factoryId }).sort({ createdAt: 1 }).lean();
}
