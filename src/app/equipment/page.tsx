import { listEquipment } from '@/domain/equipment/service';
import { canManageEquipment, canViewEquipmentCatalogue } from '@/domain/equipment/policy';
import {
  EQUIPMENT_CATEGORY_LABELS,
  OPERATIONAL_STATUS_LABELS,
} from '@/domain/equipment/schema';
import { getCurrentActor } from '@/lib/auth/currentActor';
import AddEquipmentForm from '@/components/equipment/AddEquipmentForm';
import EquipmentRowEditor from '@/components/equipment/EquipmentRowEditor';
import { TechnicalSupportNav } from '@/components/equipment/TechnicalSupportNav';

/**
 * SCRUM-240 Maintain the equipment catalogue.
 *
 * AC1 every item is listed with its name, category, quantity and current
 *     location; the add form records a new one.
 * AC2 the operational status is shown, and changed from the row it belongs to.
 * AC3 a role other than Technical Support Staff sees no add form and no row
 *     editor, and the API refuses it as well (TC-240-07: a hidden button is
 *     not a refusal, so both halves matter).
 *
 * A server component reading through the domain service. The API routes exist
 * for the browser to write through, not for the app to call itself over HTTP.
 *
 * force-dynamic, so a status saved through the API is read back from the
 * stored row on the next load rather than from a cached render (TC-240-04).
 */

export const dynamic = 'force-dynamic';

export default async function EquipmentCataloguePage() {
  const actor = await getCurrentActor();

  if (!canViewEquipmentCatalogue(actor.roles)) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Equipment catalogue</h1>
        <p className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          Your role does not have access to the equipment catalogue.
        </p>
      </main>
    );
  }

  const canManage = canManageEquipment(actor.roles);
  const equipment = await listEquipment();

  return (
    <main className="mx-auto max-w-5xl p-6">
      {/* SCRUM-164: Technical Support Staff move between this and their request queue. */}
      {canManage ? <TechnicalSupportNav current="catalogue" /> : null}
      <h1 className="mb-2 text-2xl font-semibold">Equipment catalogue</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        The equipment ConnectSphere owns, with the quantity held and where it is kept.
        {canManage
          ? ' Technical Support Staff maintain it.'
          : ' Technical Support Staff maintain it; you can see it to choose from.'}
      </p>

      {canManage ? (
        <div className="mb-6 max-w-md">
          <AddEquipmentForm />
        </div>
      ) : null}

      {equipment.length === 0 ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          No equipment in the catalogue yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th scope="col" className="p-3 font-medium">
                  Name
                </th>
                <th scope="col" className="p-3 font-medium">
                  Category
                </th>
                <th scope="col" className="p-3 font-medium">
                  Quantity
                </th>
                <th scope="col" className="p-3 font-medium">
                  Current location
                </th>
                <th scope="col" className="p-3 font-medium">
                  Operational status
                </th>
                {canManage ? (
                  <th scope="col" className="p-3 font-medium">
                    Change status or quantity
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {equipment.map((item) => (
                <tr key={item.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3">{item.name}</td>
                  <td className="p-3">{EQUIPMENT_CATEGORY_LABELS[item.category]}</td>
                  <td className="p-3">{item.quantity}</td>
                  <td className="p-3">{item.currentLocation}</td>
                  <td className="p-3">{OPERATIONAL_STATUS_LABELS[item.operationalStatus]}</td>
                  {canManage ? (
                    <td className="p-3">
                      <EquipmentRowEditor item={item} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-sm text-[var(--text-muted)]">
        {equipment.length} {equipment.length === 1 ? 'item' : 'items'} in the catalogue.
      </p>
    </main>
  );
}
